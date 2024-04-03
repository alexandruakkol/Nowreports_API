# Nowreports API Module

## What is Nowreports?

Nowreports is a web application composed of three modules: Portal, API and AI, each having its own Github repository. Nowreports leverages company financial reports in order to allow users to inquire about the way a certain business works and is performing. State-of-the-art AI techniques are used to process data and create models that will allow the user to chat with the AI just like they would with the executive board of their chosen company. This enables users to obtain valuable insights into the internal business processes that may not be as easily accessible through other sources.

The API module was built with NodeJS, Postgres, Express, and Firebase.

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
