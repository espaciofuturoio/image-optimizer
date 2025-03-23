# Image Optimizer

A powerful image optimization service that efficiently compresses and converts images to modern formats like WebP and AVIF, reducing file sizes while maintaining visual quality.

<div align="center">
  <img src="https://github.com/espaciofuturoio/image-optimizer/blob/main/DEMO.gif" alt="Video demostration">
</div>

[Live Demo](https://tinyimage.rubenabix.com/)

## Tech Stack

- **Monorepo Structure**: Organized as a monorepo for better code sharing and management
- **Bunjs**: Ultra-fast JavaScript runtime and package manager
- **Docker**: Containerized deployment for consistent environments
- **Elysia**: High-performance TypeScript framework for the API
- **Vite**: Fast frontend build tool and development server
- **React 19**: Latest version of React for the web interface
- **Tailwind CSS**: Utility-first CSS framework
- **DaisyUI 5**: Component library for Tailwind CSS

## Features

- Image optimization with adjustable quality settings
- Support for multiple output formats (WebP, AVIF, JPEG, PNG)
- Custom dimensions for resizing images
- Browser-based client for uploading and previewing optimized images
- RESTful API for programmatic access
- Docker containerization for easy deployment

## Getting Started

### Development

Install dependencies:

```bash
bun install
```

Run the API server:

```bash
cd apps/api
bun run index.ts
```

Run the web uploader:

```bash
cd apps/uploader
bun run dev
```

### Docker Deployment

Development mode:

```bash
docker-compose -f docker-compose.apps-api.yml up -d --build
```

Production mode:

```bash
docker-compose -f docker-compose.production.yml up --build
```

## API Usage

The API exposes an endpoint at `/upload/optimize` that accepts multipart form data with the following parameters:

- `file`: The image file to optimize
- `format`: Output format (webp, avif, jpeg, png)
- `quality`: Compression quality (0-100)
- `width`: Target width (optional)
- `height`: Target height (optional)

The API documentation is available at `/docs` when the server is running.

## Architecture

The project is structured as a monorepo with two main applications:

1. **API (apps/api)**: Elysia-based API server that handles image optimization
2. **Uploader (apps/uploader)**: React frontend for uploading and previewing optimized images

The API server also serves the built frontend, making it a self-contained application when deployed.
