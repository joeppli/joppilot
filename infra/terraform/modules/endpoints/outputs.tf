output "interface_endpoint_ids" {
  description = "Map of service name => interface endpoint id."
  value       = { for k, e in aws_vpc_endpoint.interface : k => e.id }
}

output "s3_endpoint_id" {
  description = "S3 gateway endpoint id."
  value       = aws_vpc_endpoint.s3.id
}
