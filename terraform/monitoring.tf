# EFS for Grafana and Prometheus persistent storage
resource "aws_efs_file_system" "monitoring" {
  count = var.enable_monitoring ? 1 : 0

  creation_token = "${var.project_name}-monitoring"
  encrypted      = true

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-monitoring-efs"
  })
}

resource "aws_efs_mount_target" "monitoring" {
  count = var.enable_monitoring ? length(module.vpc.private_subnets) : 0

  file_system_id  = aws_efs_file_system.monitoring[0].id
  subnet_id       = module.vpc.private_subnets[count.index]
  security_groups = [aws_security_group.efs[0].id]
}

resource "aws_security_group" "efs" {
  count = var.enable_monitoring ? 1 : 0

  name_prefix = "${var.project_name}-efs-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port   = 2049
    to_port     = 2049
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

# Prometheus Task Definition
resource "aws_ecs_task_definition" "prometheus" {
  count = var.enable_monitoring ? 1 : 0

  family                   = "${var.project_name}-prometheus"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn

  volume {
    name = "prometheus-data"

    efs_volume_configuration {
      file_system_id = aws_efs_file_system.monitoring[0].id
      root_directory = "/prometheus"
    }
  }

  container_definitions = jsonencode([
    {
      name  = "prometheus"
      image = "prom/prometheus:latest"
      
      portMappings = [
        {
          containerPort = 9090
          protocol      = "tcp"
        }
      ]

      mountPoints = [
        {
          sourceVolume  = "prometheus-data"
          containerPath = "/prometheus"
          readOnly      = false
        }
      ]

      command = [
        "--config.file=/etc/prometheus/prometheus.yml",
        "--storage.tsdb.path=/prometheus",
        "--storage.tsdb.retention.time=200h",
        "--web.enable-lifecycle"
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.prometheus.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])

  tags = var.tags
}

# Grafana Task Definition
resource "aws_ecs_task_definition" "grafana" {
  count = var.enable_monitoring ? 1 : 0

  family                   = "${var.project_name}-grafana"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn

  volume {
    name = "grafana-data"

    efs_volume_configuration {
      file_system_id = aws_efs_file_system.monitoring[0].id
      root_directory = "/grafana"
    }
  }

  container_definitions = jsonencode([
    {
      name  = "grafana"
      image = "grafana/grafana:latest"
      
      portMappings = [
        {
          containerPort = 3000
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "GF_SECURITY_ADMIN_PASSWORD", value = "admin" },
        { name = "GF_INSTALL_PLUGINS", value = "grafana-clock-panel,grafana-simple-json-datasource" }
      ]

      mountPoints = [
        {
          sourceVolume  = "grafana-data"
          containerPath = "/var/lib/grafana"
          readOnly      = false
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.grafana.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])

  tags = var.tags
}

# Prometheus Service
resource "aws_ecs_service" "prometheus" {
  count = var.enable_monitoring ? 1 : 0

  name            = "${var.project_name}-prometheus"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.prometheus[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.prometheus[0].arn
  }

  depends_on = [aws_efs_mount_target.monitoring]

  tags = var.tags
}

# Grafana Service
resource "aws_ecs_service" "grafana" {
  count = var.enable_monitoring ? 1 : 0

  name            = "${var.project_name}-grafana"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.grafana[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = module.alb.target_groups["grafana"].arn
    container_name   = "grafana"
    container_port   = 3000
  }

  depends_on = [aws_efs_mount_target.monitoring, module.alb]

  tags = var.tags
}

# Service Discovery for Prometheus
resource "aws_service_discovery_private_dns_namespace" "main" {
  count = var.enable_monitoring ? 1 : 0

  name = "${var.project_name}.local"
  vpc  = module.vpc.vpc_id

  tags = var.tags
}

resource "aws_service_discovery_service" "prometheus" {
  count = var.enable_monitoring ? 1 : 0

  name = "prometheus"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main[0].id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }

  tags = var.tags
}
