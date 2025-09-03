#![cfg_attr(not(feature = "std"), no_std)]

// Add Solana-specific implementation module
#[cfg(not(feature = "std"))]
pub mod solana_impl;

#[cfg(feature = "std")]
use std::collections::HashMap;

#[cfg(not(feature = "std"))]
use hashbrown::HashMap;

#[cfg(not(feature = "std"))]
#[macro_use]
extern crate alloc;

#[cfg(not(feature = "std"))]
use alloc::{
    string::{String, ToString},
    vec::Vec,
};

pub type IMTNode = String;
pub type IMTHashFunction = fn(Vec<IMTNode>) -> IMTNode;

#[derive(Debug)]
pub struct LeanIMT {
    size: usize,
    depth: usize,
    side_nodes: HashMap<usize, IMTNode>,
    leaves: HashMap<IMTNode, usize>,
    hash: IMTHashFunction,
}

impl LeanIMT {
    pub fn new(hash: IMTHashFunction) -> Self {
        LeanIMT {
            size: 0,
            depth: 0,
            side_nodes: HashMap::new(),
            leaves: HashMap::new(),
            hash,
        }
    }

    /// Inserts a new leaf into the tree.
    pub fn insert(&mut self, leaf: IMTNode) -> Result<IMTNode, &'static str> {
        if self.leaves.contains_key(&leaf) {
            return Err("Leaf already exists");
        }
        if leaf == "0" {
            return Err("Leaf cannot be zero");
        }

        let mut index = self.size;
        let mut tree_depth = self.depth;

        // Increase tree depth if necessary
        if (1 << tree_depth) < index + 1 {
            tree_depth += 1;
            self.depth = tree_depth;
        }

        let mut node = leaf.clone();

        for level in 0..tree_depth {
            if ((index >> level) & 1) == 1 {
                // If the bit at position `level` is 1, hash with the side node
                let side_node = self
                    .side_nodes
                    .get(&level)
                    .cloned()
                    .expect("No side node at this level");
                node = (self.hash)(vec![side_node, node]);
            } else {
                // Else, store the node as side node
                self.side_nodes.insert(level, node.clone());
            }
        }

        index += 1;
        self.size = index;

        // Update the root node
        self.side_nodes.insert(tree_depth, node.clone());
        self.leaves.insert(leaf, index);

        Ok(node)
    }

    /// Inserts multiple leaves into the tree.
    pub fn insert_many(&mut self, leaves: Vec<IMTNode>) -> Result<IMTNode, &'static str> {
        // Validate leaves
        for leaf in &leaves {
            if self.leaves.contains_key(leaf) {
                return Err("Leaf already exists");
            }
            if leaf == "0" {
                return Err("Leaf cannot be zero");
            }
        }

        let mut current_level_new_nodes = leaves.clone();

        let tree_size = self.size;
        let mut tree_depth = self.depth;

        // Calculate new tree depth
        while (1 << tree_depth) < tree_size + leaves.len() {
            tree_depth += 1;
        }
        self.depth = tree_depth;

        let mut current_level_start_index = tree_size;
        let mut current_level_size = tree_size + leaves.len();
        let mut next_level_start_index = current_level_start_index >> 1;
        let mut next_level_size = ((current_level_size - 1) >> 1) + 1;

        for level in 0..tree_depth {
            let number_of_new_nodes = next_level_size - next_level_start_index;
            let mut next_level_new_nodes = Vec::with_capacity(number_of_new_nodes);

            for i in 0..number_of_new_nodes {
                let left_index = (i + next_level_start_index) * 2 - current_level_start_index;
                let right_index = left_index + 1;

                let left_node = if left_index < current_level_new_nodes.len() {
                    current_level_new_nodes[left_index].clone()
                } else {
                    self.side_nodes
                        .get(&level)
                        .cloned()
                        .unwrap_or("0".to_string())
                };

                let right_node = if right_index < current_level_new_nodes.len() {
                    current_level_new_nodes[right_index].clone()
                } else {
                    "0".to_string()
                };

                let parent_node = if right_node != "0" {
                    (self.hash)(vec![left_node.clone(), right_node])
                } else {
                    left_node.clone()
                };

                next_level_new_nodes.push(parent_node);
            }

            // Update side nodes
            if current_level_size & 1 == 1 {
                self.side_nodes
                    .insert(level, current_level_new_nodes.last().cloned().unwrap());
            } else if current_level_new_nodes.len() > 1 {
                self.side_nodes.insert(
                    level,
                    current_level_new_nodes
                        .get(current_level_new_nodes.len() - 2)
                        .cloned()
                        .unwrap(),
                );
            }

            current_level_start_index = next_level_start_index;
            next_level_start_index >>= 1;

            current_level_new_nodes = next_level_new_nodes;
            current_level_size = next_level_size;
            next_level_size = ((next_level_size - 1) >> 1) + 1;
        }

        // Update tree size and root
        self.size = tree_size + leaves.len();
        self.side_nodes
            .insert(tree_depth, current_level_new_nodes[0].clone());

        // Update leaves mapping
        for (i, leaf) in leaves.iter().enumerate() {
            self.leaves.insert(leaf.clone(), tree_size + i + 1);
        }

        Ok(current_level_new_nodes[0].clone())
    }

    /// Updates an existing leaf in the tree.
    pub fn update(
        &mut self,
        old_leaf: &IMTNode,
        new_leaf: IMTNode,
        sibling_nodes: &[IMTNode],
    ) -> Result<IMTNode, &'static str> {
        if !self.leaves.contains_key(old_leaf) {
            return Err("Leaf does not exist");
        }
        if self.leaves.contains_key(&new_leaf) && new_leaf != "0" {
            return Err("New leaf already exists");
        }

        let index = self.index_of(old_leaf)?;
        let mut node = new_leaf.clone();
        let mut old_root = old_leaf.clone();

        let last_index = self.size - 1;
        let mut i = 0;

        let tree_depth = self.depth;

        for level in 0..tree_depth {
            if ((index >> level) & 1) == 1 {
                let sibling_node = sibling_nodes
                    .get(i)
                    .cloned()
                    .ok_or("Not enough sibling nodes")?;
                node = (self.hash)(vec![sibling_node.clone(), node]);
                old_root = (self.hash)(vec![sibling_node, old_root]);
                i += 1;
            } else {
                if (index >> level) != (last_index >> level) {
                    let sibling_node = sibling_nodes
                        .get(i)
                        .cloned()
                        .ok_or("Not enough sibling nodes")?;
                    node = (self.hash)(vec![node, sibling_node.clone()]);
                    old_root = (self.hash)(vec![old_root, sibling_node]);
                    i += 1;
                } else {
                    self.side_nodes.insert(level, node.clone());
                }
            }
        }

        if Some(old_root) != self.root() {
            return Err("Wrong sibling nodes");
        }

        self.side_nodes.insert(tree_depth, node.clone());

        if new_leaf != "0" {
            let leaf_index = *self.leaves.get(old_leaf).unwrap();
            self.leaves.insert(new_leaf.clone(), leaf_index);
        }

        self.leaves.remove(old_leaf);

        Ok(node)
    }

    /// Removes a leaf from the tree.
    pub fn remove(
        &mut self,
        old_leaf: &IMTNode,
        sibling_nodes: &[IMTNode],
    ) -> Result<IMTNode, &'static str> {
        self.update(old_leaf, "0".to_string(), sibling_nodes)
    }

    /// Checks if a leaf exists in the tree.
    pub fn has(&self, leaf: &IMTNode) -> bool {
        self.leaves.contains_key(leaf)
    }

    /// Returns the index of a leaf in the tree.
    pub fn index_of(&self, leaf: &IMTNode) -> Result<usize, &'static str> {
        self.leaves
            .get(leaf)
            .map(|&index| index - 1)
            .ok_or("Leaf does not exist")
    }

    /// Returns the root of the tree.
    pub fn root(&self) -> Option<IMTNode> {
        self.side_nodes.get(&self.depth).cloned()
    }

    /// Getter Functions for Debugging
    pub fn get_size(&self) -> usize {
        self.size
    }

    pub fn get_depth(&self) -> usize {
        self.depth
    }

    pub fn get_side_nodes(&self) -> HashMap<usize, IMTNode> {
        self.side_nodes.clone()
    }

    pub fn get_leaves(&self) -> HashMap<IMTNode, usize> {
        self.leaves.clone()
    }
}

#[cfg(all(feature = "std", test))]
mod tests {
    use super::*;

    fn simple_hash_function(nodes: Vec<String>) -> String {
        nodes.join(",")
    }

    #[test]
    fn test_new_lean_imt() {
        let hash: IMTHashFunction = simple_hash_function;
        let imt = LeanIMT::new(hash);

        assert_eq!(imt.size, 0);
        assert_eq!(imt.depth, 0);
        assert!(imt.root().is_none());
    }

    #[test]
    fn test_insert() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        assert!(imt.insert("leaf1".to_string()).is_ok());
        assert_eq!(imt.size, 1);
        assert_eq!(imt.depth, 0);
        assert!(imt.has(&"leaf1".to_string()));
        assert_eq!(imt.root().unwrap(), "leaf1".to_string());
    }

    #[test]
    fn test_insert_() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        assert!(imt.insert("leaf1".to_string()).is_ok());
        assert_eq!(imt.size, 1);
        assert_eq!(imt.depth, 0);
        assert!(imt.has(&"leaf1".to_string()));
        assert_eq!(imt.root().unwrap(), "leaf1".to_string());

        assert!(imt.insert("leaf2".to_string()).is_ok());
        assert_eq!(imt.size, 2);
        assert_eq!(imt.depth, 1);
        assert!(imt.has(&"leaf2".to_string()));
        assert_eq!(imt.root().unwrap(), "leaf1,leaf2".to_string());

        assert!(imt.insert("leaf3".to_string()).is_ok());
        assert_eq!(imt.size, 3);
        assert_eq!(imt.depth, 2);
        assert!(imt.has(&"leaf3".to_string()));
        assert_eq!(imt.root().unwrap(), "leaf1,leaf2,leaf3".to_string());

        assert!(imt.insert("leaf4".to_string()).is_ok());
        assert_eq!(imt.size, 4);
        assert_eq!(imt.depth, 2);
        assert!(imt.has(&"leaf4".to_string()));
        assert_eq!(imt.root().unwrap(), "leaf1,leaf2,leaf3,leaf4".to_string());

        assert!(imt.insert("leaf5".to_string()).is_ok());
        assert_eq!(imt.size, 5);
        assert_eq!(imt.depth, 3);
        assert!(imt.has(&"leaf5".to_string()));
        assert_eq!(
            imt.root().unwrap(),
            "leaf1,leaf2,leaf3,leaf4,leaf5".to_string()
        );
    }

    #[test]
    fn test_insert_many() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        let leaves = vec![
            "leaf1".to_string(),
            "leaf2".to_string(),
            "leaf3".to_string(),
        ];
        assert!(imt.insert_many(leaves.clone()).is_ok());
        assert_eq!(imt.size, 3);
        assert_eq!(imt.depth, 2);
        for leaf in &leaves {
            assert!(imt.has(leaf));
        }
        // Expected root calculation
        let expected_root = simple_hash_function(vec![
            simple_hash_function(vec![leaves[0].clone(), leaves[1].clone()]),
            leaves[2].clone(),
        ]);
        assert_eq!(imt.root().unwrap(), expected_root);
    }

    #[test]
    fn test_insert_duplicate_leaf() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        imt.insert("leaf1".to_string()).unwrap();
        let result = imt.insert("leaf1".to_string());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Leaf already exists");
    }

    #[test]
    fn test_insert_many_with_duplicate_leaf() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        imt.insert("leaf1".to_string()).unwrap();
        let leaves = vec!["leaf2".to_string(), "leaf1".to_string()];
        let result = imt.insert_many(leaves);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Leaf already exists");
    }

    #[test]
    fn test_update() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        imt.insert("leaf1".to_string()).unwrap();
        let sibling_nodes = vec![];
        assert!(imt
            .update(
                &"leaf1".to_string(),
                "new_leaf1".to_string(),
                &sibling_nodes
            )
            .is_ok());
        assert!(imt.has(&"new_leaf1".to_string()));
        assert!(!imt.has(&"leaf1".to_string()));
        assert_eq!(imt.root().unwrap(), "new_leaf1".to_string());
    }

    #[test]
    fn test_update_nonexistent_leaf() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        let sibling_nodes = vec![];
        let result = imt.update(
            &"nonexistent_leaf".to_string(),
            "new_leaf".to_string(),
            &sibling_nodes,
        );
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Leaf does not exist");
    }

    #[test]
    fn test_remove() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        imt.insert("leaf1".to_string()).unwrap();
        let sibling_nodes = vec![];
        assert!(imt.remove(&"leaf1".to_string(), &sibling_nodes).is_ok());
        assert!(!imt.has(&"leaf1".to_string()));
        assert_eq!(imt.root().unwrap(), "0".to_string());
    }

    #[test]
    fn test_remove_nonexistent_leaf() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        let sibling_nodes = vec![];
        let result = imt.remove(&"nonexistent_leaf".to_string(), &sibling_nodes);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Leaf does not exist");
    }

    #[test]
    fn test_has_and_index_of() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        assert!(!imt.has(&"leaf1".to_string()));
        assert!(imt.index_of(&"leaf1".to_string()).is_err());

        imt.insert("leaf1".to_string()).unwrap();
        assert!(imt.has(&"leaf1".to_string()));
        assert_eq!(imt.index_of(&"leaf1".to_string()).unwrap(), 0);
    }

    #[test]
    fn test_root_after_operations() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        // Initially empty tree
        assert!(imt.root().is_none());

        // Insert leaf1
        imt.insert("leaf1".to_string()).unwrap();
        let root_after_leaf1 = imt.root().unwrap();

        // Insert leaf2
        imt.insert("leaf2".to_string()).unwrap();
        let root_after_leaf2 = imt.root().unwrap();
        assert_ne!(root_after_leaf1, root_after_leaf2);

        // Remove leaf1
        let sibling_nodes = vec!["leaf2".to_string()];
        imt.remove(&"leaf1".to_string(), &sibling_nodes).unwrap();
        let root_after_removal = imt.root().unwrap();
        assert_eq!(root_after_removal, "0,leaf2".to_string());

        // Update leaf2
        let sibling_nodes = vec!["0".to_string()];
        imt.update(&"leaf2".to_string(), "leaf3".to_string(), &sibling_nodes)
            .unwrap();
        let root_after_update = imt.root().unwrap();
        assert_eq!(root_after_update, "0,leaf3".to_string());
    }

    #[test]
    fn test_tree_consistency() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        // Insert leaves
        imt.insert("leaf1".to_string()).unwrap();
        imt.insert("leaf2".to_string()).unwrap();
        imt.insert("leaf3".to_string()).unwrap();
        imt.insert("leaf4".to_string()).unwrap();

        // Current root
        let root_before = imt.root().unwrap();

        // Update leaf2
        let sibling_nodes = vec![
            "leaf1".to_string(),
            simple_hash_function(vec!["leaf3".to_string(), "leaf4".to_string()]),
        ];
        imt.update(
            &"leaf2".to_string(),
            "leaf2_updated".to_string(),
            &sibling_nodes,
        )
        .unwrap();

        // New root should be different
        let root_after = imt.root().unwrap();
        assert_ne!(root_before, root_after);

        // Remove leaf3
        let sibling_nodes = vec![
            "leaf4".to_string(),
            simple_hash_function(vec!["leaf1".to_string(), "leaf2_updated".to_string()]),
        ];
        imt.remove(&"leaf3".to_string(), &sibling_nodes).unwrap();

        // Root should change again
        let root_after_removal = imt.root().unwrap();
        assert_ne!(root_after, root_after_removal);

        // Check that leaves are correctly updated
        assert!(imt.has(&"leaf1".to_string()));
        assert!(imt.has(&"leaf2_updated".to_string()));
        assert!(!imt.has(&"leaf2".to_string()));
        assert!(!imt.has(&"leaf3".to_string()));
        assert!(imt.has(&"leaf4".to_string()));
    }

    #[test]
    fn test_large_number_of_leaves() {
        let hash: IMTHashFunction = |nodes: Vec<String>| {
            // Simple hash function that simulates combining nodes
            format!("H({})", nodes.join("+"))
        };
        let mut imt = LeanIMT::new(hash);

        // Insert 100 leaves
        let leaves: Vec<_> = (1..=100).map(|i| format!("leaf{}", i)).collect();
        assert!(imt.insert_many(leaves.clone()).is_ok());
        assert_eq!(imt.size, 100);

        // Check that all leaves are present
        for leaf in &leaves {
            assert!(imt.has(leaf));
        }

        // Check that the tree depth is correct
        let expected_depth = (100 as f64).log2().ceil() as usize;
        assert_eq!(imt.depth, expected_depth);
    }

    #[test]
    fn test_insertion_after_removal() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        // Insert leaves
        imt.insert("leaf1".to_string()).unwrap();
        imt.insert("leaf2".to_string()).unwrap();

        // Remove leaf1
        let sibling_nodes = vec!["leaf2".to_string()];
        imt.remove(&"leaf1".to_string(), &sibling_nodes).unwrap();

        // Insert new leaf
        assert!(imt.insert("leaf3".to_string()).is_ok());

        // Check that leaves are correctly updated
        assert!(!imt.has(&"leaf1".to_string()));
        assert!(imt.has(&"leaf2".to_string()));
        assert!(imt.has(&"leaf3".to_string()));
    }

    #[test]
    fn test_tree_after_all_leaves_removed() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        // Insert leaves
        imt.insert("leaf1".to_string()).unwrap();
        imt.insert("leaf2".to_string()).unwrap();

        // Remove all leaves
        let sibling_nodes = vec!["leaf2".to_string()];
        imt.remove(&"leaf1".to_string(), &sibling_nodes).unwrap();

        let sibling_nodes = vec!["0".to_string()];
        imt.remove(&"leaf2".to_string(), &sibling_nodes).unwrap();

        // Tree should be empty
        assert_eq!(imt.size, 2);
        assert_eq!(imt.depth, 1);
        assert_eq!(imt.root().unwrap(), "0,0".to_string());
        assert!(!imt.has(&"leaf1".to_string()));
        assert!(!imt.has(&"leaf2".to_string()));
    }

    #[test]
    fn test_insert_after_tree_becomes_empty() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        // Insert and remove leaves
        imt.insert("leaf1".to_string()).unwrap();
        let sibling_nodes = vec![];
        imt.remove(&"leaf1".to_string(), &sibling_nodes).unwrap();

        // Insert new leaf
        assert!(imt.insert("leaf2".to_string()).is_ok());
        assert!(imt.has(&"leaf2".to_string()));
        assert_eq!(imt.root().unwrap(), "0,leaf2".to_string());
    }

    #[test]
    fn test_insertion_causes_depth_increase() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        // Insert leaves to fill tree of depth 0
        imt.insert("leaf1".to_string()).unwrap();
        assert_eq!(imt.depth, 0);

        // Insert leaves to fill tree of depth 1
        imt.insert("leaf2".to_string()).unwrap();
        assert_eq!(imt.depth, 1);

        // Insert another leaf, depth should increase
        imt.insert("leaf3".to_string()).unwrap();
        assert_eq!(imt.depth, 2);

        // Insert leaves to fill tree of depth 2
        imt.insert("leaf4".to_string()).unwrap();
        assert_eq!(imt.depth, 2);

        // Insert another leaf, depth should increase
        imt.insert("leaf5".to_string()).unwrap();
        assert_eq!(imt.depth, 3);
    }

    #[test]
    fn test_invalid_sibling_nodes_on_update() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        // Insert leaves
        imt.insert("leaf1".to_string()).unwrap();
        imt.insert("leaf2".to_string()).unwrap();

        // Try to update with incorrect sibling nodes
        let sibling_nodes = vec!["wrong_sibling".to_string()];
        let result = imt.update(
            &"leaf1".to_string(),
            "leaf1_updated".to_string(),
            &sibling_nodes,
        );
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Wrong sibling nodes");
    }

    #[test]
    fn test_invalid_sibling_nodes_on_remove() {
        let hash: IMTHashFunction = simple_hash_function;
        let mut imt = LeanIMT::new(hash);

        // Insert leaves
        imt.insert("leaf1".to_string()).unwrap();
        imt.insert("leaf2".to_string()).unwrap();

        // Try to remove with incorrect sibling nodes
        let sibling_nodes = vec!["wrong_sibling".to_string()];
        let result = imt.remove(&"leaf1".to_string(), &sibling_nodes);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Wrong sibling nodes");
    }
}
