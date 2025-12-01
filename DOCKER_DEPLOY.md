# Docker Deployment Guide

## Local Docker Deployment

### 1. Prepare Environment Variables

Create `.env` file (from `.env.example`):

```bash
cp .env.example .env
```

Edit `.env` file, configure authentication method (choose one based on priority):

```env
# Method 1: Use fixed API key (recommended for production)
FACTORY_API_KEY=your_factory_api_key_here

# Method 2: Use refresh token to automatically refresh
DROID_REFRESH_KEY=your_actual_refresh_token_here
```

**Priority: FACTORY_API_KEY > DROID_REFRESH_KEY > Client authorization**

### 2. Start with Docker Compose

```bash
docker-compose up -d
```

View logs:

```bash
docker-compose logs -f
```

Stop service:

```bash
docker-compose down
```

### 3. Use Native Docker Command

**Build image:**

```bash
docker build -t droid2api:latest .
```

**Run container:**

```bash
# Method 1: Use fixed API key
docker run -d \
  --name droid2api \
  -p 3000:3000 \
  -e FACTORY_API_KEY="your_factory_api_key_here" \
  droid2api:latest

# Method 2: Use refresh token to automatically refresh
docker run -d \
  --name droid2api \
  -p 3000:3000 \
  -e DROID_REFRESH_KEY="your_refresh_token_here" \
  droid2api:latest
```

**View logs:**

```bash
docker logs -f droid2api
```

**Stop container:**

```bash
docker stop droid2api
docker rm droid2api
```

## Cloud Platform Deployment

### Render.com Deployment

1. In Render, create a new Web Service
2. Connect your GitHub repository
3. Configure:
   - **Environment**: Docker
   - **Branch**: docker-deploy
   - **Port**: 3000
4. Add environment variables (choose one):
   - `FACTORY_API_KEY`: Fixed API key (recommended)
   - `DROID_REFRESH_KEY`: refresh token
5. Click "Create Web Service"

### Railway Deployment

1. In Railway, create a new project
2. Select "Deploy from GitHub repo"
3. Select branch: docker-deploy
4. Railway will automatically detect Dockerfile
5. Add environment variables (choose one):
   - `FACTORY_API_KEY`: Fixed API key (recommended)
   - `DROID_REFRESH_KEY`: refresh token
6. Deploy completed, will automatically assign a domain name

### Fly.io Deployment

1. Install Fly CLI:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. Login:
   ```bash
   fly auth login
   ```

3. Initialize application (in project directory):
   ```bash
   fly launch
   ```

4. Set environment variables (choose one):
   ```bash
   # Use fixed API key (recommended)
   fly secrets set FACTORY_API_KEY="your_factory_api_key_here"
   
   # Or use refresh token
   fly secrets set DROID_REFRESH_KEY="your_refresh_token_here"
   ```

5. Deploy:
   ```bash
   fly deploy
   ```

### Google Cloud Run Deployment

1. Build and push image:
   ```bash
   gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/droid2api
   ```

2. Deploy to Cloud Run:
   ```bash
   # Use fixed API key (recommended)
   gcloud run deploy droid2api \
     --image gcr.io/YOUR_PROJECT_ID/droid2api \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars FACTORY_API_KEY="your_factory_api_key_here" \
     --port 3000
   
   # Or use refresh token
   gcloud run deploy droid2api \
     --image gcr.io/YOUR_PROJECT_ID/droid2api \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars DROID_REFRESH_KEY="your_refresh_token_here" \
     --port 3000
   ```

### AWS ECS Deployment

1. Create ECR repository
2. Push image to ECR
3. Create ECS task definition
4. Configure environment variables (choose one):
   - `FACTORY_API_KEY` (recommended)
   - `DROID_REFRESH_KEY`
5. Create ECS service

## Persistent Configuration

If you need to persist refresh tokens:

### Docker Compose Way

Modify `docker-compose.yml`:

```yaml
services:
  droid2api:
    volumes:
      - auth-data:/app
      
volumes:
  auth-data:
```

### Docker Command Way

```bash
docker volume create droid2api-data

# Use fixed API key
docker run -d \
  --name droid2api \
  -p 3000:3000 \
  -e FACTORY_API_KEY="your_factory_api_key_here" \
  -v droid2api-data:/app \
  droid2api:latest

# Or use refresh token
docker run -d \
  --name droid2api \
  -p 3000:3000 \
  -e DROID_REFRESH_KEY="your_refresh_token_here" \
  -v droid2api-data:/app \
  droid2api:latest
```

## Health Check

After container starts, you can check the service status through the following endpoints:

```bash
curl http://localhost:3000/
curl http://localhost:3000/v1/models
```

## Environment Variable Description

| Variable Name | Required | Priority | Description |
|--------|------|--------|------|
| `FACTORY_API_KEY` | No | Highest | Fixed API key, skip auto refresh (recommended for production) |
| `DROID_REFRESH_KEY` | No | Second Highest | Factory refresh token, used to auto refresh API key |
| `NODE_ENV` | No | - | Run environment, default production |

**Note**: `FACTORY_API_KEY` and `DROID_REFRESH_KEY` must be configured at least one

## Troubleshooting

### Container cannot start

View logs:
```bash
docker logs droid2api
```

Common issues:
- Missing authentication configuration (`FACTORY_API_KEY` or `DROID_REFRESH_KEY`)
- Invalid or expired API key or refresh token
- Port 3000 is already in use

### API Request Returns 401

**Reason**: API key or refresh token expired or invalid

**Solution**:
1. If using `FACTORY_API_KEY`: check if the key is valid
2. If using `DROID_REFRESH_KEY`: get a new refresh token
3. Update environment variables
4. Restart container

### Container Frequently Restarts

Check health check logs and application logs, it may be:
- Insufficient memory
- API key refresh failed
- Configuration file error

## Security Recommendations

1. **Do not commit `.env` file to Git**
2. **Use secrets to manage sensitive information** (e.g., GitHub Secrets, Docker Secrets)
3. **Production environment recommended to use `FACTORY_API_KEY`** (more stable, no need to refresh)
4. **Regularly update API keys and refresh tokens**
5. **Enable HTTPS** (cloud platforms usually provide automatically)
6. **Limit access sources** (through firewalls or cloud platform configuration)

## Performance Optimization

### Multi-stage build (optional)

```dockerfile
# Build stage
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

# 生产阶段
FROM node:24-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### Resource Limit

Add to docker-compose.yml:

```yaml
services:
  droid2api:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

## Monitoring and Logging

### View real-time logs

```bash
docker-compose logs -f
```

### Export logs

```bash
docker logs droid2api > droid2api.log 2>&1
```

### Integration with monitoring tools

Can be integrated:
- Prometheus + Grafana
- Datadog
- New Relic
- Sentry (error tracking)
