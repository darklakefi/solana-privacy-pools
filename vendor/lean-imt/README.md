# LeanIMT: A Lightweight Incremental Merkle Tree

A Lean implementation of an Incremental Merkle Tree (IMT). It supports insertion, deletion, and updating of leaves, all while maintaining the integrity and root hash of the tree. The tree is built using a customizable hash function.

> [!WARNING]
> This library has not been audited, please use at your own risk.

## Installation

To use LeanIMT, add the following to your `Cargo.toml`:

```toml
[dependencies]
lean_imt = "0.1.2"
```

If you are using a no_std environment, you can disable the default features:

```toml
[dependencies]
lean_imt = { version = "0.1.2", default-features = false }
```

## Usage

### 1. Import the necessary modules

```rust
use std::collections::HashMap;
use lean_imt::{LeanIMT, IMTNode, IMTHashFunction};
```

### 2. Define a simple hash function

```rust
fn simple_hash(nodes: Vec<IMTNode>) -> IMTNode {
    nodes.join(",")
}
```

### 3. Create a new LeanIMT instance

```rust
let hash_function: IMTHashFunction = simple_hash;
let mut imt = LeanIMT::new(hash_function);
```

### 4. Insert a single leaf

```rust
let leaf = "leaf1".to_string();
match imt.insert(leaf.clone()) {
    Ok(root) => println!("New root: {}", root),
    Err(e) => println!("Error: {}", e),
}
```

### 5. Insert multiple leaves

```rust
let leaves = vec!["leaf1".to_string(), "leaf2".to_string(), "leaf3".to_string()];
match imt.insert_many(leaves.clone()) {
    Ok(root) => println!("New root after batch insert: {}", root),
    Err(e) => println!("Error: {}", e),
}
```

### 6. Update an existing leaf

```rust
let old_leaf = "leaf1".to_string();
let new_leaf = "leaf1_updated".to_string();
let sibling_nodes = vec![]; // You would populate this based on the Merkle proof
match imt.update(&old_leaf, new_leaf.clone(), &sibling_nodes) {
    Ok(new_root) => println!("Updated root: {}", new_root),
    Err(e) => println!("Error: {}", e),
}
```

### 7. Remove a leaf

```rust
let leaf_to_remove = "leaf1".to_string();
let sibling_nodes = vec![]; // Populate this based on the Merkle proof
match imt.remove(&leaf_to_remove, &sibling_nodes) {
    Ok(new_root) => println!("New root after removal: {}", new_root),
    Err(e) => println!("Error: {}", e),
}
```

### 8. Check if a leaf exists

```rust
if imt.has(&"leaf1".to_string()) {
    println!("Leaf exists in the tree.");
} else {
    println!("Leaf not found.");
}
```

### 9. Get the root of the tree

```rust
match imt.root() {
    Some(root) => println!("Current root: {}", root),
    None => println!("Tree is empty"),
}
```

### 10. Retrieve Tree Size and Depth

```rust
println!("Tree size: {}", imt.get_size());
println!("Tree depth: {}", imt.get_depth());
```

## Example

Here's a full example using the library:

```rust
fn main() {
    let hash_function: IMTHashFunction = simple_hash;
    let mut imt = LeanIMT::new(hash_function);

    // Insert leaves
    imt.insert("leaf1".to_string()).unwrap();
    imt.insert("leaf2".to_string()).unwrap();

    // Check the root
    let root = imt.root().unwrap();
    println!("Root after insertion: {}", root);

    // Update a leaf
    let sibling_nodes = vec!["leaf2".to_string()];
    imt.update(&"leaf1".to_string(), "new_leaf1".to_string(), &sibling_nodes).unwrap();

    // Check updated root
    let updated_root = imt.root().unwrap();
    println!("Updated root: {}", updated_root);

    // Remove a leaf
    imt.remove(&"new_leaf1".to_string(), &sibling_nodes).unwrap();

    // Final root after removal
    let final_root = imt.root().unwrap();
    println!("Root after removal: {}", final_root);
}
```

## Testing

To run the test suite, use the following command:

```bash
cargo test
```

Tests cover the basic operations of insertion, removal, and updates, as well as ensuring consistency across multiple tree operations.
