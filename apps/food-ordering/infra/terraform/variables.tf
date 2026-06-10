variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region for the bucket and DocumentDB cluster."
}

# ── Amazon DocumentDB (opt-in) ────────────────────────────────────────────────
variable "create_docdb" {
  type        = bool
  default     = false
  description = "Provision the DocumentDB cluster (paid). Leave false to manage only S3 + IAM."
}

variable "docdb_master_username" {
  type        = string
  default     = "brainadmin"
  description = "DocumentDB master username."
}

variable "docdb_master_password" {
  type        = string
  default     = null
  sensitive   = true
  description = "DocumentDB master password (required when create_docdb = true; 8-100 chars)."
}

variable "docdb_instance_class" {
  type        = string
  default     = "db.t3.medium"
  description = "DocumentDB instance class."
}

variable "docdb_instance_count" {
  type        = number
  default     = 1
  description = "Number of DocumentDB instances in the cluster."
}

variable "docdb_allowed_cidr" {
  type        = list(string)
  default     = ["10.0.0.0/8"]
  description = "CIDR(s) allowed to reach DocumentDB on 27017 (e.g. your app subnet/VPC)."
}

variable "bucket_name" {
  type        = string
  description = "Globally-unique S3 bucket name for the company-brain knowledge base."
}

variable "force_destroy" {
  type        = bool
  default     = false
  description = "Allow `terraform destroy` to delete a non-empty bucket. Handy for POC teardown."
}

variable "raw_ia_transition_days" {
  type        = number
  default     = 30
  description = "Days before raw/ originals move to STANDARD_IA."
}

variable "raw_glacier_transition_days" {
  type        = number
  default     = 90
  description = "Days before raw/ originals move to GLACIER."
}

variable "noncurrent_version_expiration_days" {
  type        = number
  default     = 90
  description = "Days before noncurrent object versions are expired."
}

variable "tags" {
  type        = map(string)
  default     = { Project = "company-brain", ManagedBy = "terraform" }
  description = "Tags applied to all resources."
}
