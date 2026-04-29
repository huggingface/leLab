# HTTPS Setup for Phone Camera Support

## Generated Files
- `certs/cert.pem` - SSL certificate
- `certs/key.pem` - Private key

## Usage
The frontend should automatically use HTTPS when these certificates are present.

## Access URLs
- Desktop: https://localhost:5173
- Mobile: https://192.168.1.103:5173

## Security Notes
- These certificates are for development only
- Self-signed certificates will show browser warnings
- For trusted certificates, install mkcert: https://github.com/FiloSottile/mkcert

## Troubleshooting
If you see certificate errors:
1. Accept the security warning in your browser
2. For mobile devices, you may need to manually accept the certificate
3. Consider using mkcert for automatically trusted certificates

Generated on: 2025-06-19 15:43:14
