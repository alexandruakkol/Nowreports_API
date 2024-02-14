import dotenv from 'dotenv';
import Stripe from 'stripe';

dotenv.config();

async function stripeConfig(){
    const stripe = new Stripe(process.env.STRIPE_APIKEY);
    return stripe;
}

export default stripeConfig;