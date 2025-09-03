const js = "05d4f09883f74d30cd8b4af3e5e01130a47d7bb572c66f461ef5348989530ee7";
const rust = "e70e53898934f51e466fc672b57b7da43011e0e5f34a8bcd304df78398f0d405";

const jsReversed = js.match(/.{2}/g).reverse().join('');

console.log("JS:          ", js);
console.log("Rust:        ", rust);
console.log("JS reversed: ", jsReversed);
console.log("Match?       ", jsReversed === rust);
