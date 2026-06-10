# ──────────────────────────────────────────────────────────────────────────────
# Amazon DocumentDB (MongoDB-compatible) — the knowledge-base catalog/search store.
#
# Opt-in: set create_docdb = true (it provisions a paid cluster). Lives in your
# default VPC and is reachable only inside the VPC — run the app in the same VPC,
# or use an SSH tunnel / bastion for local dev.
# ──────────────────────────────────────────────────────────────────────────────
data "aws_vpc" "default" {
  count   = var.create_docdb ? 1 : 0
  default = true
}

data "aws_subnets" "default" {
  count = var.create_docdb ? 1 : 0
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default[0].id]
  }
}

resource "aws_docdb_subnet_group" "brain" {
  count      = var.create_docdb ? 1 : 0
  name       = "company-brain-docdb"
  subnet_ids = data.aws_subnets.default[0].ids
  tags       = var.tags
}

resource "aws_security_group" "docdb" {
  count       = var.create_docdb ? 1 : 0
  name        = "company-brain-docdb"
  description = "DocumentDB access for company-brain"
  vpc_id      = data.aws_vpc.default[0].id

  ingress {
    description = "MongoDB wire protocol from allowed CIDR(s)"
    from_port   = 27017
    to_port     = 27017
    protocol    = "tcp"
    cidr_blocks = var.docdb_allowed_cidr
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

resource "aws_docdb_cluster" "brain" {
  count                  = var.create_docdb ? 1 : 0
  cluster_identifier     = "company-brain"
  engine                 = "docdb"
  master_username        = var.docdb_master_username
  master_password        = var.docdb_master_password
  db_subnet_group_name   = aws_docdb_subnet_group.brain[0].name
  vpc_security_group_ids = [aws_security_group.docdb[0].id]
  storage_encrypted      = true
  deletion_protection    = false
  skip_final_snapshot    = true
  tags                   = var.tags
}

resource "aws_docdb_cluster_instance" "brain" {
  count              = var.create_docdb ? var.docdb_instance_count : 0
  identifier         = "company-brain-${count.index + 1}"
  cluster_identifier = aws_docdb_cluster.brain[0].id
  instance_class     = var.docdb_instance_class
  tags               = var.tags
}
