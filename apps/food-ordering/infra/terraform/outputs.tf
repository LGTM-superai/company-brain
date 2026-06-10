output "bucket_name" {
  description = "Name of the knowledge-base bucket."
  value       = aws_s3_bucket.brain.id
}

output "bucket_arn" {
  description = "ARN of the knowledge-base bucket."
  value       = aws_s3_bucket.brain.arn
}

output "reader_access_keys" {
  description = "Per-role IAM access keys. Store these in the Mongo `users` collection (POC). Retrieve with: terraform output -json reader_access_keys"
  sensitive   = true
  value = {
    for role in keys(local.role_tiers) : role => {
      aws_access_key_id     = aws_iam_access_key.reader[role].id
      aws_secret_access_key = aws_iam_access_key.reader[role].secret
    }
  }
}

output "ingest_access_key" {
  description = "IAM access key for the ingest pipeline. Retrieve with: terraform output -json ingest_access_key"
  sensitive   = true
  value = {
    aws_access_key_id     = aws_iam_access_key.ingest.id
    aws_secret_access_key = aws_iam_access_key.ingest.secret
  }
}

output "docdb_endpoint" {
  description = "DocumentDB cluster endpoint (null unless create_docdb = true)."
  value       = var.create_docdb ? aws_docdb_cluster.brain[0].endpoint : null
}

output "docdb_uri_template" {
  description = "MONGODB_URI template — substitute your password. Null unless create_docdb = true."
  value = var.create_docdb ? format(
    "mongodb://%s:<PASSWORD>@%s:27017/?tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false",
    var.docdb_master_username, aws_docdb_cluster.brain[0].endpoint,
  ) : null
}
