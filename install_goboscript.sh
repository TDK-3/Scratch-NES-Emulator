curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
cargo +nightly install --git https://github.com/aspizu/goboscript --locked