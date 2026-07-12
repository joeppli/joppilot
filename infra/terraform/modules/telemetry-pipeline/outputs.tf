output "lambda_security_group_id" {
  description = "SG of the ingest Lambda — reference it in the RDS ingress list"
  value       = aws_security_group.lambda.id
}

output "queue_url" {
  description = "Ingest SQS queue URL"
  value       = aws_sqs_queue.ingest.id
}

output "dlq_url" {
  description = "Dead-letter queue URL (poisoned telemetry messages)"
  value       = aws_sqs_queue.dlq.id
}

output "rule_name" {
  description = "IoT Topic Rule name"
  value       = aws_iot_topic_rule.telemetry.name
}

output "lambda_function_name" {
  description = "Ingest Lambda name (aws logs tail /aws/lambda/<this>)"
  value       = aws_lambda_function.ingest.function_name
}
