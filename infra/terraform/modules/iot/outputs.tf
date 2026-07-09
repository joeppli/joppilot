output "iot_endpoint" {
  description = "IoT Core ATS data endpoint (AWS_IOT_ENDPOINT for the services/edge)."
  value       = data.aws_iot_endpoint.ats.endpoint_address
}

output "thing_names" {
  description = "Provisioned thing names (one per vehicle id)."
  value       = [for t in aws_iot_thing.vehicle : t.name]
}

output "vehicle_cert_secret_arns" {
  description = "Map of vehicle id → Secrets Manager ARN holding its IoT cert bundle (cert/key/rootCa/endpoint)."
  value       = { for k, s in aws_secretsmanager_secret.vehicle_cert : k => s.arn }
}

output "service_cert_secret_arn" {
  description = "Secrets Manager ARN holding the cloud services' IoT cert bundle (mounted into ECS in a later slice)."
  value       = aws_secretsmanager_secret.service_cert.arn
}
