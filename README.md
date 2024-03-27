# Nowreports API Module

Built with NodeJS, Postgres, Express, and Firebase.

This module serves three major functions in the Nowreports system:
- serving dynamic data to the Nowreports Portal
- handing payments and subscriptions through Stripe
- keeping the database up to date with the latest financial reports

Google Firebase is only used for authentication.

Deployed in production on nowreports.com/api, via Nginx Reverse Proxy and PM2 for process management.

Availability and performance is being monitored using Uptime Robot.

## Files

- `main.js`: Entry point
- `DBOps.js`: Database interface
- `webserver.js`: API routes
- `server.js` and `DLFilings.js`: Mechanisms used to fetch financial reports
- `stripe.js`: Connects to Stripe API  

## Usage and arguments

- `node main` (no arguments): Starts the API only.
- `populate-append`: Starts the API and fetches newly listed companies' reports only.
- `populate-append-reverse`: Starts the API and fetches newly listed companies' reports only, by market cap in descending order.
- `populate-update`: Starts the API and fetches new reports.
