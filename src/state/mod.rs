pub mod zero_copy;
pub mod lean_imt;

// Export the Lean IMT implementation as the primary one
pub use lean_imt::*;

// Keep zero_copy for backwards compatibility during migration
pub use zero_copy::{NullifierStateZC, DepositorStateZC};

#[cfg(any(test, feature = "test-utils"))]
pub mod test_compat;
#[cfg(any(test, feature = "test-utils"))]
pub use test_compat::*;