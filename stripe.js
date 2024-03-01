import dotenv from 'dotenv';
import Stripe from 'stripe';

dotenv.config();

async function stripeConfig(){
    const stripe_secret = process.env.ENV === 'production' ? process.env?.STRIPE_APIKEY : process.env?.STRIPE_TEST_APIKEY;
    if(!stripe_secret) return console.error('No stripe API KEY!');
    console.log(process.env.ENV === 'production' ? 'Stripe LIVE OK' : 'Stripe TEST OK');
    const stripe = new Stripe(stripe_secret);
    return stripe;
}

export default stripeConfig;