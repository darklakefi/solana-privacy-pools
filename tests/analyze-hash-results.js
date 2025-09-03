// Analyze the hash results to understand the pattern

const results = {
    "zero_values": {
        js: "2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864",
        rust: "6448b64684ee39a823d5fe5fd52431dc81e4817bf2c3ea3cab9e239efbf59820"
    },
    "small_values": {
        js: "115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a",
        rust: "eb0a78aedd676b0fe2e3dc361060be6ee4d318a813e3060d7177455ba943e91a"
    }
};

console.log("Analyzing hash patterns:\n");

for (const [test, hashes] of Object.entries(results)) {
    console.log(`Test: ${test}`);
    console.log(`JS:   ${hashes.js}`);
    console.log(`Rust: ${hashes.rust}`);

    // Check if Rust is reversed JS
    const jsReversed = hashes.js.match(/.{2}/g).reverse().join('');
    console.log(`JS reversed: ${jsReversed}`);
    console.log(`Match? ${jsReversed === hashes.rust ? 'YES' : 'NO'}`);

    // Check if they share any patterns
    const jsChunks = hashes.js.match(/.{8}/g);
    const rustChunks = hashes.rust.match(/.{8}/g);

    console.log("\nJS 8-byte chunks:", jsChunks);
    console.log("Rust 8-byte chunks:", rustChunks);

    // Check if any chunks appear in both (possibly reversed)
    for (let i = 0; i < jsChunks.length; i++) {
        const chunk = jsChunks[i];
        const chunkReversed = chunk.match(/.{2}/g).reverse().join('');

        if (rustChunks.includes(chunk)) {
            console.log(`  Chunk ${i} "${chunk}" appears in Rust at position ${rustChunks.indexOf(chunk)}`);
        }
        if (rustChunks.includes(chunkReversed)) {
            console.log(`  Chunk ${i} "${chunk}" (reversed: "${chunkReversed}") appears in Rust at position ${rustChunks.indexOf(chunkReversed)}`);
        }
    }

    console.log("\n---\n");
}

// Also check if it's a word-order issue (64-bit words)
console.log("Checking 64-bit word order:\n");

for (const [test, hashes] of Object.entries(results)) {
    console.log(`Test: ${test}`);

    // Split into 64-bit words (16 hex chars = 8 bytes = 64 bits)
    const jsWords = hashes.js.match(/.{16}/g);
    const rustWords = hashes.rust.match(/.{16}/g);

    console.log("JS words:", jsWords);
    console.log("Rust words:", rustWords);

    // Check if Rust is JS with words in different order
    const jsWordsReversed = [...jsWords].reverse();
    const rustAsString = rustWords.join('');
    const jsReversedAsString = jsWordsReversed.join('');

    if (rustAsString === jsReversedAsString) {
        console.log("✓ Rust is JS with 64-bit words reversed!");
    } else {
        console.log("✗ Not a simple word reversal");
    }

    console.log("\n");
}
