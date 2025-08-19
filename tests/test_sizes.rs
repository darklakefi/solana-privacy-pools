#[cfg(test)]
mod test_sizes {
    use solana_privacy_pools::state::zero_copy::*;

    #[test]
    fn print_sizes() {
        println!("PrivacyPoolStateZC::LEN = {}", PrivacyPoolStateZC::LEN);
        println!("DepositorStateZC::LEN = {}", DepositorStateZC::LEN);
        println!("NullifierStateZC::LEN = {}", NullifierStateZC::LEN);
        
        // Also print size_of for verification
        println!("size_of::<PrivacyPoolStateZC>() = {}", std::mem::size_of::<PrivacyPoolStateZC>());
        println!("size_of::<DepositorStateZC>() = {}", std::mem::size_of::<DepositorStateZC>());
        println!("size_of::<NullifierStateZC>() = {}", std::mem::size_of::<NullifierStateZC>());
    }
}