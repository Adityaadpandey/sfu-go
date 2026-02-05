output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = module.alb.dns_name
}

output "alb_zone_id" {
  description = "Zone ID of the Application Load Balancer"
  value       = module.alb.zone_id
}

output "ecr_sfu_repository_url" {
  description = "URL of the SFU ECR repository"
  value       = aws_ecr_repository.sfu.repository_url
}

output "ecr_frontend_repository_url" {
  description = "URL of the Frontend ECR repository"
  value       = aws_ecr_repository.frontend.repository_url
}

output "redis_endpoint" {
  description = "Redis cluster endpoint"
  value       = aws_elasticache_cluster.redis.cache_nodes[0].address
}

output "redis_port" {
  description = "Redis cluster port"
  value       = aws_elasticache_cluster.redis.cache_nodes[0].port
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = aws_ecs_cluster.main.name
}

output "vpc_id" {
  description = "ID of the VPC"
  value       = module.vpc.vpc_id
}

output "grafana_url" {
  description = "URL to access Grafana dashboard"
  value       = var.enable_monitoring ? "http://${module.alb.dns_name}/grafana" : "Monitoring disabled"
}

output "prometheus_internal_endpoint" {
  description = "Internal endpoint for Prometheus"
  value       = var.enable_monitoring ? "http://prometheus.${var.project_name}.local:9090" : "Monitoring disabled"
}

output "deployment_commands" {
  description = "Commands to deploy Docker images to ECR"
  value       = <<-EOT
    # Login to ECR
    aws ecr get-login-password --region ${var.aws_region} | docker login --username AWS --password-stdin ${aws_ecr_repository.sfu.repository_url}
    
    # Build and push SFU backend
    cd backend
    docker build -t ${aws_ecr_repository.sfu.repository_url}:latest .
    docker push ${aws_ecr_repository.sfu.repository_url}:latest
    
    # Build and push Frontend
    cd ../frontend
    docker build -t ${aws_ecr_repository.frontend.repository_url}:latest .
    docker push ${aws_ecr_repository.frontend.repository_url}:latest
  EOT
}
