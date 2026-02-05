# SFU Terraform Infrastructure

This directory contains Terraform configurations to deploy the SFU application to AWS using ECS Fargate.

## Architecture

The infrastructure includes:

- **VPC**: Multi-AZ VPC with public and private subnets
- **ECS Cluster**: Fargate-based container orchestration
- **Application Load Balancer**: Routes traffic to frontend and SFU backend
- **ElastiCache Redis**: Shared state management for SFU instances
- **ECR Repositories**: Docker image storage
- **EFS**: Persistent storage for Prometheus and Grafana
- **CloudWatch**: Centralized logging
- **Prometheus**: Metrics collection and alerting
- **Grafana**: Visualization dashboards

## Prerequisites

1. **AWS CLI** configured with appropriate credentials
2. **Terraform** >= 1.0 installed
3. **Docker** for building and pushing images

## Quick Start

### 1. Initialize Terraform

```bash
cd terraform
terraform init
```

### 2. Review and Customize Variables

Edit `terraform.tfvars` (create if it doesn't exist):

```hcl
aws_region              = "us-east-1"
project_name            = "sfu-app"
vpc_cidr                = "10.0.0.0/16"
availability_zones      = ["us-east-1a", "us-east-1b", "us-east-1c"]
redis_node_type         = "cache.t3.micro"
sfu_max_rooms           = 1000
sfu_max_peers_per_room  = 100
enable_monitoring       = true

tags = {
  Project     = "SFU"
  Environment = "production"
  ManagedBy   = "Terraform"
}
```

### 3. Plan Infrastructure

```bash
terraform plan
```

### 4. Deploy Infrastructure

```bash
terraform apply
```

This will create:
- VPC and networking components
- ECS cluster
- Load balancer
- Redis cluster
- ECR repositories
- Monitoring stack (Prometheus + Grafana)

### 5. Build and Push Docker Images

After infrastructure is created, get the ECR repository URLs:

```bash
terraform output ecr_sfu_repository_url
terraform output ecr_frontend_repository_url
```

Login to ECR:

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
```

Build and push images:

```bash
# Backend
cd ../backend
docker build -t <ecr-sfu-url>:latest .
docker push <ecr-sfu-url>:latest

# Frontend
cd ../frontend
docker build -t <ecr-frontend-url>:latest .
docker push <ecr-frontend-url>:latest
```

Or use the deployment commands output:

```bash
terraform output deployment_commands
```

### 6. Access Your Application

Get the load balancer DNS:

```bash
terraform output alb_dns_name
```

Access:
- **Frontend**: `http://<alb-dns-name>/`
- **Grafana**: `http://<alb-dns-name>:3001` (default: admin/admin)
- **Prometheus**: Internal only via service discovery

## Monitoring Setup

### Prometheus

Prometheus is configured to scrape:
- SFU server metrics (port 9090)
- Redis metrics
- Self-monitoring

Alert rules are defined in `backend/monitoring/prometheus-alerts.yml`.

### Grafana

Grafana comes pre-configured with:
- Prometheus datasource
- SFU monitoring dashboard
- Default credentials: `admin/admin`

Access Grafana at: `http://<alb-dns-name>:3001`

## Scaling

### Horizontal Scaling

Adjust the `desired_count` in ECS services:

```hcl
# In ecs.tf
resource "aws_ecs_service" "sfu" {
  desired_count = 4  # Scale to 4 instances
}
```

### Vertical Scaling

Adjust CPU and memory in task definitions:

```hcl
# In ecs.tf
resource "aws_ecs_task_definition" "sfu" {
  cpu    = "2048"  # 2 vCPU
  memory = "4096"  # 4 GB
}
```

### Redis Scaling

Change the node type:

```hcl
# In variables.tf or terraform.tfvars
redis_node_type = "cache.t3.medium"
```

## Cost Optimization

### Development Environment

For development, reduce costs by:

```hcl
# Disable monitoring
enable_monitoring = false

# Use smaller instances
redis_node_type = "cache.t3.micro"

# Reduce ECS task resources
cpu    = "256"
memory = "512"

# Single instance
desired_count = 1
```

### Production Environment

For production:

```hcl
# Enable monitoring
enable_monitoring = true

# Use appropriate Redis instance
redis_node_type = "cache.r6g.large"

# Scale ECS tasks
desired_count = 3  # or more based on load

# Enable auto-scaling (add auto-scaling resources)
```

## Outputs

After deployment, Terraform provides:

- `alb_dns_name`: Load balancer DNS for accessing the application
- `ecr_sfu_repository_url`: ECR repository for SFU backend
- `ecr_frontend_repository_url`: ECR repository for frontend
- `redis_endpoint`: Redis cluster endpoint
- `grafana_url`: Grafana dashboard URL
- `deployment_commands`: Commands to deploy Docker images

## Cleanup

To destroy all resources:

```bash
terraform destroy
```

**Warning**: This will delete all resources including data in EFS and Redis.

## Troubleshooting

### ECS Tasks Not Starting

Check CloudWatch logs:

```bash
aws logs tail /ecs/sfu-app/sfu --follow
```

### Cannot Push to ECR

Ensure you're logged in:

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
```

### Load Balancer Health Checks Failing

Verify:
1. Security groups allow traffic
2. Container health check endpoint is responding
3. Task has started successfully

### Redis Connection Issues

Check:
1. Security group allows port 6379 from ECS tasks
2. Redis cluster is in the same VPC
3. Environment variable `REDIS_ADDR` is correct

## Advanced Configuration

### Custom Domain

Add Route53 and ACM certificate:

```hcl
# Add to main.tf
resource "aws_acm_certificate" "main" {
  domain_name       = "sfu.example.com"
  validation_method = "DNS"
}

resource "aws_route53_record" "main" {
  zone_id = var.route53_zone_id
  name    = "sfu.example.com"
  type    = "A"

  alias {
    name                   = module.alb.dns_name
    zone_id                = module.alb.zone_id
    evaluate_target_health = true
  }
}
```

### Auto Scaling

Add auto-scaling policies:

```hcl
resource "aws_appautoscaling_target" "sfu" {
  max_capacity       = 10
  min_capacity       = 2
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.sfu.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "sfu_cpu" {
  name               = "sfu-cpu-autoscaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.sfu.resource_id
  scalable_dimension = aws_appautoscaling_target.sfu.scalable_dimension
  service_namespace  = aws_appautoscaling_target.sfu.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 70.0
  }
}
```

## Security Best Practices

1. **Use Secrets Manager** for sensitive data
2. **Enable VPC Flow Logs** for network monitoring
3. **Use IAM roles** with least privilege
4. **Enable encryption** for EFS, ECR, and Redis
5. **Implement WAF** on the ALB
6. **Use private subnets** for ECS tasks
7. **Enable container insights** for detailed monitoring

## Support

For issues or questions:
1. Check CloudWatch logs
2. Review Terraform plan output
3. Verify AWS service quotas
4. Check security group rules
