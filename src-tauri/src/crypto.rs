//! Cryptographic primitives for Folio.
//!
//! Design:
//! - The master password is stretched into a 256-bit key with Argon2id
//!   (memory-hard, resistant to GPU/ASIC brute force).
//! - Entries are sealed with AES-256-GCM, an authenticated cipher: a wrong
//!   key (i.e. wrong password) fails decryption rather than returning garbage.
//! - A fresh random 96-bit nonce is generated for every encryption and stored
//!   alongside the ciphertext. Never reuse a nonce with the same key.
//! - The derived key lives only in memory and is zeroized on drop.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use zeroize::Zeroize;

/// Length of the salt stored per-vault, in bytes.
pub const SALT_LEN: usize = 16;
/// AES-GCM nonce length, in bytes (96 bits, the standard for GCM).
pub const NONCE_LEN: usize = 12;
/// Derived key length, in bytes (256 bits).
pub const KEY_LEN: usize = 32;

/// A derived encryption key. Zeroized from memory when dropped.
#[derive(Clone)]
pub struct VaultKey([u8; KEY_LEN]);

impl Drop for VaultKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl VaultKey {
    fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }
}

/// Generate `n` cryptographically secure random bytes from the OS RNG.
pub fn random_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    buf
}

/// Argon2id parameters. ~64 MiB memory, 3 iterations — a good desktop balance
/// (a few hundred ms to unlock) that is painful to brute-force.
fn argon2() -> Argon2<'static> {
    let params = Params::new(64 * 1024, 3, 1, Some(KEY_LEN)).expect("valid argon2 params");
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

/// Stretch a password + salt into a 256-bit vault key using Argon2id.
pub fn derive_key(password: &str, salt: &[u8]) -> Result<VaultKey, String> {
    let mut key = [0u8; KEY_LEN];
    argon2()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("key derivation failed: {e}"))?;
    Ok(VaultKey(key))
}

/// Encrypt `plaintext`, returning `nonce || ciphertext`.
pub fn encrypt(key: &VaultKey, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_bytes()));

    let nonce_bytes = random_bytes(NONCE_LEN);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| "encryption failed".to_string())?;

    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt data produced by [`encrypt`] (`nonce || ciphertext`).
/// Returns an error if the key is wrong or the data was tampered with.
pub fn decrypt(key: &VaultKey, data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < NONCE_LEN {
        return Err("ciphertext too short".to_string());
    }
    let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_bytes()));
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "decryption failed (wrong password or corrupted data)".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let salt = random_bytes(SALT_LEN);
        let key = derive_key("correct horse battery staple", &salt).unwrap();
        let msg = b"Dear diary, today was a good day.";
        let sealed = encrypt(&key, msg).unwrap();
        let opened = decrypt(&key, &sealed).unwrap();
        assert_eq!(opened, msg);
    }

    #[test]
    fn wrong_password_fails() {
        let salt = random_bytes(SALT_LEN);
        let key = derive_key("right", &salt).unwrap();
        let wrong = derive_key("wrong", &salt).unwrap();
        let sealed = encrypt(&key, b"secret").unwrap();
        assert!(decrypt(&wrong, &sealed).is_err());
    }
}
