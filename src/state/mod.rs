pub mod zero_copy;
pub mod lean_imt;
pub mod pool;

// Export the pool state and Lean IMT implementation
pub use pool::PoolStateLeanIMT;
pub use lean_imt::*;

// Keep zero_copy for backwards compatibility during migration
pub use zero_copy::{NullifierStateZC, DepositorStateZC};

#[cfg(any(test, feature = "test-utils"))]
pub mod test_compat;
#[cfg(any(test, feature = "test-utils"))]
pub use test_compat::*;