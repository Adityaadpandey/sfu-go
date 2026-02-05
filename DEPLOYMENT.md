# SFU Application Deployment Guide

Complete guide for deploying the SFU application with Terraform, Prometheus, and Grafana monitoring.

## Table of Contents

1. [Local Development Setup](#local-development-setup)
2. [AWS Production Deployment](#aws-production-deployment)
3. [Monitoring Setup](#monitoring-setup)
4. [Terraform Usage](#terraform-usage)
5. [Troubleshooting](#troubleshooting)

---

## Local Development Setup

### Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for frontend development)
- Go 1.21+ (for backend development)

### Quick Start

1. **Start the full stack locally:**

```bash
# Start all services (backend, frontend, redis, prometheus, grafana)
docker-compose up --build
```

2. **Access services:**

- Frontend: http://localhost (via nginx)
- SFU Backend: http://localhost:8080
- Grafana: http://localhost:3001 (admin/admin)
- Prometheus: http://localhost:9091

3. **Development mode (frontend only):**

```bash
# Start backend stack
docker-compose up -d sfu-server redis prometheus grafana

# Run frontend in dev mode
cd frontend
npm install
npm run dev
```

Frontend will be available at http://localhost:3000

---

## AWS Production Deployment

### Prerequisites

1. **AWS Account** with appropriate permissions
2. **AWS CLI** configured:
   ```bash
   aws configure
   ```
3. **Terraform** installed (>= 1.0):
   ```bash
   brew install terraform  # macOS
   # or download from https://www.terraform.io/downloads
   ```
4. **Docker** for building images

### Step 1: Configure Terraform

1. **Navigate to terraform directory:**

   ```bash
   cd terraform
   ```

2. **Copy example variables:**

   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

3. **Edit terraform.tfvars:**
   ```hcl
   aws_region              = "ap-south-1"
   project_name            = "sfu-app"
   vpc_cidr                = "10.0.0.0/16"
   availability_zones      = ["ap-south-1a", "ap-south-1b"]
   redis_node_type         = "cache.t3.micro"
   sfu_max_rooms           = 1000
   sfu_max_peers_per_room  = 100
   enable_monitoring       = true
   ```

### Step 2: Initialize and Deploy Infrastructure

1. **Initialize Terraform:**

   ```bash
   terraform init
   ```

2. **Review the plan:**

   ```bash
   terraform plan
   ```

3. **Deploy infrastructure:**

   ```bash
   terraform apply
   ```

   Type `yes` when prompted. This will create:

   - VPC with public/private subnets
   - ECS Cluster
   - Application Load Balancer
   - ElastiCache Redis
   - ECR Repositories
   - EFS for monitoring data
   - CloudWatch Log Groups
   - Prometheus and Grafana services

4. **Save outputs:**
   ```bash
   terraform output > ../deployment-info.txt
   ```

### Step 3: Build and Push Docker Images

1. **Get ECR login command:**

   ```bash
   aws ecr get-login-password --region us-east-1 | \
     docker login --username AWS --password-stdin \
     $(terraform output -raw ecr_sfu_repository_url | cut -d'/' -f1)
   ```

2. **Build and push backend(Make sure to build for x86):**

   ```bash
   cd ../backend

   # Get ECR URL
   ECR_SFU=$(cd ../terraform && terraform output -raw ecr_sfu_repository_url)

   # Build and push
   docker build -t $ECR_SFU:latest .
   docker push $ECR_SFU:latest
   ```

3. **Build and push frontend(Make sure to build for x86):**

   ```bash
   cd ../frontend

   # Get ECR URL
   ECR_FRONTEND=$(cd ../terraform && terraform output -raw ecr_frontend_repository_url)

   # Build and push
   docker build -t $ECR_FRONTEND:latest .
   docker push $ECR_FRONTEND:latest
   ```

### Step 4: Deploy ECS Services

After pushing images, ECS will automatically pull and deploy them. Monitor the deployment:

```bash
# Watch ECS service status
aws ecs describe-services \
  --cluster sfu-app-cluster \
  --services sfu-app-sfu sfu-app-frontend \
  --query 'services[*].[serviceName,status,runningCount,desiredCount]' \
  --output table
```

### Step 5: Access Your Application

Get the load balancer DNS:

```bash
cd terraform
terraform output alb_dns_name
```

Access:

- **Application**: `http://<alb-dns-name>/`
- **Grafana**: `http://<alb-dns-name>:3001`

---

## Monitoring Setup

### Prometheus

Prometheus is automatically configured to scrape:

- SFU server metrics (every 5 seconds)
- Prometheus self-monitoring (every 10 seconds)
- Redis metrics (if redis_exporter is added)

**Alert Rules** are defined in `backend/monitoring/prometheus-alerts.yml`:

- High room/peer counts
- Error rate thresholds
- Memory and CPU usage
- Connection issues

### Grafana

1. **Access Grafana:**

   ```
   http://<alb-dns-name>:3001
   ```

2. **Login:**

   - Username: `admin`
   - Password: `admin` 

3. **Pre-configured Dashboard:**

   - Navigate to Dashboards → SFU Server Monitoring
   - View real-time metrics:
     - Active rooms and peers
     - WebSocket connections
     - Message rates
     - Bandwidth usage
     - CPU and memory
     - Error rates

4. **Create Custom Dashboards:**

   - Click "+" → Dashboard
   - Add panels with PromQL queries
   - Example queries:

     ```promql
     # Average peers per room
     sfu_active_peers_total / sfu_active_rooms_total

     # Message throughput
     rate(sfu_messages_sent_total[5m])

     # Error percentage
     rate(sfu_errors_total[5m]) / rate(sfu_messages_received_total[5m]) * 100
     ```

### CloudWatch Logs

View application logs:

```bash
# SFU logs
aws logs tail /ecs/sfu-app/sfu --follow

# Frontend logs
aws logs tail /ecs/sfu-app/frontend --follow

# Prometheus logs
aws logs tail /ecs/sfu-app/prometheus --follow

# Grafana logs
aws logs tail /ecs/sfu-app/grafana --follow
```

---

## Terraform Usage

### Common Commands

```bash
# Initialize
terraform init

# Format code
terraform fmt

# Validate configuration
terraform validate

# Plan changes
terraform plan

# Apply changes
terraform apply

# Show current state
terraform show

# List resources
terraform state list

# Destroy everything
terraform destroy
```

### Updating Infrastructure

1. **Modify Terraform files** (e.g., `main.tf`, `variables.tf`)

2. **Plan changes:**

   ```bash
   terraform plan
   ```

3. **Apply changes:**
   ```bash
   terraform apply
   ```

### Scaling

**Horizontal Scaling (more instances):**

Edit `terraform/ecs.tf`:

```hcl
resource "aws_ecs_service" "sfu" {
  desired_count = 4  # Increase from 2 to 4
}
```

**Vertical Scaling (more resources per instance):**

Edit `terraform/ecs.tf`:

```hcl
resource "aws_ecs_task_definition" "sfu" {
  cpu    = "2048"  # 2 vCPU
  memory = "4096"  # 4 GB
}
```

Apply changes:

```bash
terraform apply
```

### Cost Optimization

**Development Environment:**

```hcl
# terraform.tfvars
enable_monitoring       = false
redis_node_type         = "cache.t3.micro"
sfu_max_rooms           = 100
sfu_max_peers_per_room  = 50
```

In `ecs.tf`:

```hcl
desired_count = 1
cpu           = "256"
memory        = "512"
```

**Production Environment:**

```hcl
# terraform.tfvars
enable_monitoring       = true
redis_node_type         = "cache.r6g.large"
sfu_max_rooms           = 5000
sfu_max_peers_per_room  = 100
```

In `ecs.tf`:

```hcl
desired_count = 3
cpu           = "1024"
memory        = "2048"
```

---

## Troubleshooting

### ECS Tasks Not Starting

1. **Check task status:**

   ```bash
   aws ecs describe-tasks \
     --cluster sfu-app-cluster \
     --tasks $(aws ecs list-tasks --cluster sfu-app-cluster --query 'taskArns[0]' --output text)
   ```

2. **View logs:**

   ```bash
   aws logs tail /ecs/sfu-app/sfu --follow
   ```

3. **Common issues:**
   - Image not found in ECR → Push images again
   - Insufficient memory → Increase task memory
   - Health check failing → Check `/health` endpoint

### Cannot Push to ECR

1. **Re-authenticate:**

   ```bash
   aws ecr get-login-password --region us-east-1 | \
     docker login --username AWS --password-stdin \
     <account-id>.dkr.ecr.us-east-1.amazonaws.com
   ```

2. **Check repository exists:**
   ```bash
   aws ecr describe-repositories --repository-names sfu-app/sfu-server
   ```

### Load Balancer Health Checks Failing

1. **Check target health:**

   ```bash
   aws elbv2 describe-target-health \
     --target-group-arn $(terraform output -raw alb_target_group_arn)
   ```

2. **Verify security groups:**

   - ALB security group allows inbound 80/443
   - ECS task security group allows inbound from ALB
   - ECS task security group allows outbound to internet

3. **Test health endpoint:**
   ```bash
   # From within VPC
   curl http://<task-private-ip>:8080/health
   ```

### Redis Connection Issues

1. **Check Redis cluster:**

   ```bash
   aws elasticache describe-cache-clusters \
     --cache-cluster-id sfu-app-redis \
     --show-cache-node-info
   ```

2. **Verify connectivity:**

   - Redis security group allows port 6379 from ECS tasks
   - Redis is in same VPC as ECS tasks
   - `REDIS_ADDR` environment variable is correct

3. **Test from ECS task:**

   ```bash
   # Exec into running task
   aws ecs execute-command \
     --cluster sfu-app-cluster \
     --task <task-id> \
     --container sfu-server \
     --interactive \
     --command "/bin/sh"

   # Test Redis connection
   nc -zv <redis-endpoint> 6379
   ```

### Grafana Not Showing Data

1. **Check Prometheus datasource:**

   - Login to Grafana
   - Configuration → Data Sources → Prometheus
   - Click "Test" button

2. **Verify Prometheus is scraping:**

   - Access Prometheus (internal): `http://prometheus.sfu-app.local:9090`
   - Check Targets: Status → Targets
   - Verify `sfu-server` target is UP

3. **Check service discovery:**
   ```bash
   aws servicediscovery list-services
   ```

### High Costs

1. **Review current costs:**

   ```bash
   aws ce get-cost-and-usage \
     --time-period Start=2024-01-01,End=2024-01-31 \
     --granularity MONTHLY \
     --metrics BlendedCost \
     --group-by Type=SERVICE
   ```

2. **Optimize:**
   - Reduce ECS task count
   - Use smaller Redis instance
   - Disable monitoring in dev
   - Use Fargate Spot for non-critical tasks
   - Set up auto-scaling to scale down during off-hours

---

## Production Checklist

Before going to production:

- [ ] Change Grafana admin password
- [ ] Set up custom domain with Route53
- [ ] Add SSL certificate with ACM
- [ ] Configure alerting (Alertmanager or SNS)
- [ ] Set up backup for EFS (Grafana/Prometheus data)
- [ ] Enable Redis encryption at rest
- [ ] Configure Redis automatic backups
- [ ] Set up WAF on ALB
- [ ] Enable VPC Flow Logs
- [ ] Configure auto-scaling policies
- [ ] Set up CI/CD pipeline
- [ ] Document runbooks for common issues
- [ ] Set up monitoring alerts (PagerDuty, Slack, etc.)
- [ ] Review and adjust resource limits
- [ ] Enable container insights
- [ ] Set up log retention policies

---

## Additional Resources

- [Terraform AWS Provider Docs](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [ECS Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/intro.html)
- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [WebRTC Best Practices](https://webrtc.org/getting-started/overview)

---

## Support

For issues or questions:

1. Check CloudWatch logs
2. Review Terraform state
3. Verify AWS service quotas
4. Check security group rules
5. Review ECS task definitions
