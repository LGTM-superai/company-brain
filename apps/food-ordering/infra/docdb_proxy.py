#!/usr/bin/env python3
"""Provision / tear down a tiny EC2 that TCP-proxies to the VPC-only DocumentDB,
so a laptop or external app can connect to it.

    python infra/docdb_proxy.py up       # create SG + EC2 (socat), wait, test, print MONGODB_URI
    python infra/docdb_proxy.py status    # show the current proxy
    python infra/docdb_proxy.py down      # terminate the EC2 + delete the SG

Config (env or .env):
    AWS_REGION_NAME      default us-west-2
    DOCDB_ENDPOINT       DocumentDB cluster endpoint (default: the company-brain cluster)
    PROXY_ALLOWED_CIDR   ingress CIDR for tcp/27017 (default 0.0.0.0/0)

Why a socat proxy: DocumentDB is VPC-only, and the available IAM perms block SSM
(no instance profile) and SSH (no key pair). This needs only ec2:RunInstances /
CreateSecurityGroup / Authorize* / DescribeImages — no IAM role, no key pair. socat
does raw TCP passthrough, so TLS stays end-to-end to DocumentDB; connect with
directConnection=true & tlsAllowInvalidHostnames=true.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

import boto3
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parent
REGION = os.environ.get("AWS_REGION_NAME") or os.environ.get("AWS_DEFAULT_REGION", "us-west-2")
DOCDB = os.environ.get("DOCDB_ENDPOINT",
                       "company-brain.cluster-claywsokweur.us-west-2.docdb.amazonaws.com")
CIDR = os.environ.get("PROXY_ALLOWED_CIDR", "0.0.0.0/0")
SG_NAME = "company-brain-proxy"
INSTANCE_FILE = ROOT / ".proxy_instance"
IP_FILE = ROOT / ".proxy_ip"

ec2 = boto3.client("ec2", region_name=REGION)


def _default_vpc() -> str:
    return ec2.describe_vpcs(Filters=[{"Name": "isDefault", "Values": ["true"]}])["Vpcs"][0]["VpcId"]


def _public_subnet(vpc: str) -> str:
    subs = ec2.describe_subnets(Filters=[
        {"Name": "vpc-id", "Values": [vpc]},
        {"Name": "map-public-ip-on-launch", "Values": ["true"]}])["Subnets"]
    return subs[0]["SubnetId"]


def _al2023_ami() -> str:
    imgs = ec2.describe_images(Owners=["amazon"], Filters=[
        {"Name": "name", "Values": ["al2023-ami-2023*-x86_64"]},
        {"Name": "state", "Values": ["available"]}])["Images"]
    return sorted(imgs, key=lambda i: i["CreationDate"])[-1]["ImageId"]


def _get_or_create_sg(vpc: str) -> str:
    gs = ec2.describe_security_groups(Filters=[
        {"Name": "group-name", "Values": [SG_NAME]},
        {"Name": "vpc-id", "Values": [vpc]}])["SecurityGroups"]
    sg = gs[0]["GroupId"] if gs else ec2.create_security_group(
        GroupName=SG_NAME, Description="DocumentDB socat proxy", VpcId=vpc)["GroupId"]
    try:
        ec2.authorize_security_group_ingress(GroupId=sg, IpPermissions=[{
            "IpProtocol": "tcp", "FromPort": 27017, "ToPort": 27017,
            "IpRanges": [{"CidrIp": CIDR, "Description": "docdb proxy"}]}])
    except ClientError as e:
        if e.response["Error"]["Code"] != "InvalidPermission.Duplicate":
            raise
    return sg


def _running_instance():
    if not INSTANCE_FILE.exists():
        return None
    iid = INSTANCE_FILE.read_text().strip()
    try:
        inst = ec2.describe_instances(InstanceIds=[iid])["Reservations"][0]["Instances"][0]
        return inst if inst["State"]["Name"] in ("pending", "running") else None
    except ClientError:
        return None


def _mongodb_uri(ip: str) -> str:
    pw_file = ROOT / ".docdb_pw"
    pw = pw_file.read_text().strip() if pw_file.exists() else "<PASSWORD>"
    return (f"mongodb://brainadmin:{pw}@{ip}:27017/"
            "?tls=true&tlsAllowInvalidHostnames=true&directConnection=true&retryWrites=false")


def up() -> None:
    inst = _running_instance()
    if inst:
        ip = inst.get("PublicIpAddress")
        print(f"proxy already running: {inst['InstanceId']} @ {ip}")
    else:
        vpc = _default_vpc()
        sg = _get_or_create_sg(vpc)
        userdata = f"""#!/bin/bash
dnf install -y socat
cat >/etc/systemd/system/docdb-proxy.service <<EOF
[Unit]
After=network.target
[Service]
ExecStart=/usr/bin/socat TCP-LISTEN:27017,fork,reuseaddr TCP:{DOCDB}:27017
Restart=always
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now docdb-proxy
"""
        r = ec2.run_instances(
            ImageId=_al2023_ami(), InstanceType="t3.micro", MinCount=1, MaxCount=1,
            NetworkInterfaces=[{"DeviceIndex": 0, "SubnetId": _public_subnet(vpc),
                                "AssociatePublicIpAddress": True, "Groups": [sg]}],
            UserData=userdata)
        iid = r["Instances"][0]["InstanceId"]
        INSTANCE_FILE.write_text(iid)
        print(f"launched {iid} — waiting for running…")
        ec2.get_waiter("instance_running").wait(InstanceIds=[iid])
        ip = ec2.describe_instances(InstanceIds=[iid])["Reservations"][0]["Instances"][0]["PublicIpAddress"]
    IP_FILE.write_text(ip)
    print(f"proxy public IP: {ip}  (ingress {CIDR} on 27017)\n")
    print("Put this in .env:")
    print("MONGODB_URI=" + _mongodb_uri(ip))
    print("MONGO_TLS_CA_FILE=infra/global-bundle.pem")
    _test(ip)


def _test(ip: str) -> None:
    ca = ROOT / "global-bundle.pem"
    if "<PASSWORD>" in _mongodb_uri(ip) or not ca.exists():
        print("\n(skip connection test — need infra/.docdb_pw + infra/global-bundle.pem)")
        return
    try:
        from pymongo import MongoClient
    except ImportError:
        print("\n(pymongo not installed — skipping test)")
        return
    print("\ntesting connection (a fresh proxy needs ~1-2 min for socat to come up)…")
    for n in range(12):
        try:
            MongoClient(_mongodb_uri(ip), tlsCAFile=str(ca), serverSelectionTimeoutMS=4000).admin.command("ping")
            print("✅ connected to DocumentDB through the proxy")
            return
        except Exception as e:
            print(f"  [{n * 15}s] not ready: {str(e)[:60]}")
            time.sleep(15)
    print("⚠️  not reachable yet — give it another minute, then re-run `status`")


def status() -> None:
    inst = _running_instance()
    print(f"RUNNING {inst['InstanceId']} @ {inst.get('PublicIpAddress')}" if inst else "no proxy running")


def down() -> None:
    if INSTANCE_FILE.exists():
        iid = INSTANCE_FILE.read_text().strip()
        try:
            ec2.terminate_instances(InstanceIds=[iid])
            print(f"terminating {iid}…")
            ec2.get_waiter("instance_terminated").wait(InstanceIds=[iid])
        except ClientError as e:
            print("terminate:", e.response["Error"]["Code"])
        INSTANCE_FILE.unlink(missing_ok=True)
        IP_FILE.unlink(missing_ok=True)
    try:
        gs = ec2.describe_security_groups(Filters=[
            {"Name": "group-name", "Values": [SG_NAME]}])["SecurityGroups"]
        if gs:
            ec2.delete_security_group(GroupId=gs[0]["GroupId"])
            print("deleted SG", gs[0]["GroupId"])
    except ClientError as e:
        print("delete SG:", e.response["Error"]["Code"])


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    {"up": up, "down": down, "status": status}.get(
        cmd, lambda: print("usage: docdb_proxy.py up|down|status"))()
