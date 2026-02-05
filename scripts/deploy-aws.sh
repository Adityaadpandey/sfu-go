#!/bin/bash

# SFU AWS Deployment Script
# This script deploys the SFU application to AWS using Terraform

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 SFU AWS Deployment Script${NC}"
echo ""

# Check prerequisites
echo -e "${BLUE}📋 Checking prerequisites...${NC}"

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed${NC}"
    echo "Install it from: https://aws.amazon.com/cli/"
    exit 1
fi
echo -e "${GREEN}✓ AWS CLI installed${NC}"

# Check Terraform
if ! command -v terraform &> /dev/null; then
    echo -e "${RED}❌ Terraform is not installed${NC}"
    echo "Install it from: https://www.terraform.io/downloads"
    exit 1
fi
echo -e "${GREEN}✓ Terraform installed${NC}"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker installed${NC}"

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not configured${NC}"
    echo "Run: aws configure"
    exit 1
fi
echo -e "${GREEN}✓ AWS credentials configured${NC}"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 1: Initialize Terraform${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

cd terraform

if [ ! -f "terraform.tfvars" ]; then
    echo -e "${YELLOW}⚠ terraform.tfvars not found. Creating from example...${NC}"
    cp terraform.tfvars.example terraform.tfvars
    echo -e "${YELLOW}📝 Please edit terraform.tfvars with your configuration${NC}"
    echo -e "${YELLOW}Press Enter when ready to continue...${NC}"
    read
fi

terraform init

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 2: Plan Infrastructure${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

terraform plan

echo ""
echo -e "${YELLOW}Review the plan above. Continue with deployment? (yes/no)${NC}"
read -r response

if [ "$response" != "yes" ]; then
    echo -e "${RED}Deployment cancelled${NC}"
    exit 0
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 3: Deploy Infrastructure${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

terraform apply -auto-approve

echo ""
echo -e "${GREEN}✅ Infrastructure deployed successfully!${NC}"

# Get outputs
ECR_SFU=$(terraform output -raw ecr_sfu_repository_url)
ECR_FRONTEND=$(terraform output -raw ecr_frontend_repository_url)
AWS_REGION=$(terraform output -raw aws_region || echo "us-east-1")
ACCOUNT_ID=$(echo $ECR_SFU | cut -d'.' -f1 | cut -d'/' -f1)

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 4: Build and Push Docker Images${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Login to ECR
echo -e "${BLUE}🔐 Logging in to ECR...${NC}"
aws ecr get-login-password --region $AWS_REGION | \
    docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

echo ""
echo -e "${BLUE}🏗️  Building backend image...${NC}"
cd ../backend
docker build -t $ECR_SFU:latest .

echo ""
echo -e "${BLUE}📤 Pushing backend image...${NC}"
docker push $ECR_SFU:latest

echo ""
echo -e "${BLUE}🏗️  Building frontend image...${NC}"
cd ../frontend
docker build -t $ECR_FRONTEND:latest .

echo ""
echo -e "${BLUE}📤 Pushing frontend image...${NC}"
docker push $ECR_FRONTEND:latest

echo ""
echo -e "${GREEN}✅ Images pushed successfully!${NC}"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 5: Wait for ECS Services${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}⏳ Waiting for ECS services to start (this may take a few minutes)...${NC}"
sleep 30

cd ../terraform
ALB_DNS=$(terraform output -raw alb_dns_name)

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎉 Deployment Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BLUE}📍 Access your application:${NC}"
echo ""
echo -e "  🌐 Application:     ${GREEN}http://$ALB_DNS${NC}"
echo -e "  📊 Grafana:         ${GREEN}http://$ALB_DNS:3001${NC} (admin/admin)"
echo ""
echo -e "${BLUE}📝 Useful commands:${NC}"
echo ""
echo -e "  View ECS services:  ${YELLOW}aws ecs list-services --cluster sfu-app-cluster${NC}"
echo -e "  View logs:          ${YELLOW}aws logs tail /ecs/sfu-app/sfu --follow${NC}"
echo -e "  Update service:     ${YELLOW}aws ecs update-service --cluster sfu-app-cluster --service sfu-app-sfu --force-new-deployment${NC}"
echo ""
echo -e "${YELLOW}⚠️  Note: It may take a few minutes for the load balancer health checks to pass${NC}"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
