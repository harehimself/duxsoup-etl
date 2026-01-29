# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainer directly or use GitHub's private vulnerability reporting feature
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Security Best Practices

This project follows these security practices:

- Environment variables for all secrets (never committed to repo)
- Input validation on all webhook endpoints
- MongoDB connection with authentication
- Regular dependency updates via Dependabot
- npm audit in CI pipeline

## Known Security Considerations

- Webhook endpoints should be protected with authentication tokens in production
- MongoDB connection strings must use TLS in production
- Rate limiting should be configured at the infrastructure level (Render/CDN)
