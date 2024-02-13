async function exponentialBackoff(callback, maxAttempts = 5, delay = 1000) {
    let attempt = 1;

    while (attempt <= maxAttempts) {
        try {
            // Attempt to execute the callback
            const result = await callback();
            return result; // If successful, return the result
        } catch (error) {
            console.error(`Attempt ${attempt} failed: ${error}`);
            
            // If max attempts reached, rethrow the error
            if (attempt === maxAttempts) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt - 1)));
            attempt++;
        }
    }
}

export {exponentialBackoff};