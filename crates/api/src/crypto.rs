use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rand::{rngs::OsRng, RngCore};
use thiserror::Error;

const VERSION_PREFIX: &str = "v1:";
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("invalid encryption key format; expected 32-byte base64 or 64-char hex")]
    InvalidKey,
    #[error("invalid ciphertext format")]
    InvalidCiphertext,
    #[error("encryption failure")]
    EncryptFailed,
    #[error("decryption failure")]
    DecryptFailed,
}

#[derive(Clone)]
pub struct TokenCipher {
    key: [u8; KEY_LEN],
}

impl std::fmt::Debug for TokenCipher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TokenCipher")
            .field("key", &"[REDACTED]")
            .finish()
    }
}

impl TokenCipher {
    /// Parse a 32-byte key encoded either as standard base64 or 64-character hex.
    pub fn from_encoded_key(raw: &str) -> Result<Self, CryptoError> {
        let trimmed = raw.trim();
        if trimmed.len() == KEY_LEN * 2 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
            let mut key = [0u8; KEY_LEN];
            for (i, chunk) in trimmed.as_bytes().chunks_exact(2).enumerate() {
                let hex_str = std::str::from_utf8(chunk).map_err(|_| CryptoError::InvalidKey)?;
                key[i] = u8::from_str_radix(hex_str, 16).map_err(|_| CryptoError::InvalidKey)?;
            }
            return Ok(Self { key });
        }

        let decoded = B64.decode(trimmed).map_err(|_| CryptoError::InvalidKey)?;
        if decoded.len() != KEY_LEN {
            return Err(CryptoError::InvalidKey);
        }
        let mut key = [0u8; KEY_LEN];
        key.copy_from_slice(&decoded);
        Ok(Self { key })
    }

    pub fn generate_random_key_b64() -> String {
        let mut key = [0u8; KEY_LEN];
        OsRng.fill_bytes(&mut key);
        B64.encode(key)
    }

    pub fn encrypt(&self, plaintext: &str) -> Result<String, CryptoError> {
        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|_| CryptoError::InvalidKey)?;
        let mut nonce_bytes = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|_| CryptoError::EncryptFailed)?;

        let mut payload = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        payload.extend_from_slice(&nonce_bytes);
        payload.extend_from_slice(&ciphertext);

        Ok(format!("{VERSION_PREFIX}{}", B64.encode(payload)))
    }

    pub fn decrypt(&self, encoded: &str) -> Result<String, CryptoError> {
        let b64_part = encoded
            .strip_prefix(VERSION_PREFIX)
            .ok_or(CryptoError::InvalidCiphertext)?;
        let payload = B64
            .decode(b64_part)
            .map_err(|_| CryptoError::InvalidCiphertext)?;
        if payload.len() <= NONCE_LEN {
            return Err(CryptoError::InvalidCiphertext);
        }

        let (nonce_bytes, ciphertext) = payload.split_at(NONCE_LEN);
        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|_| CryptoError::InvalidKey)?;
        let nonce = Nonce::from_slice(nonce_bytes);

        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| CryptoError::DecryptFailed)?;
        String::from_utf8(plaintext).map_err(|_| CryptoError::DecryptFailed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_encrypt_decrypt_base64_and_hex() {
        let b64_key = TokenCipher::generate_random_key_b64();
        let cipher = TokenCipher::from_encoded_key(&b64_key).expect("valid b64 key");
        let secret = "ya29.demo-access-token-value";

        let enc1 = cipher.encrypt(secret).expect("encrypt 1");
        let enc2 = cipher.encrypt(secret).expect("encrypt 2");
        assert!(enc1.starts_with("v1:"));
        assert_ne!(enc1, enc2, "random nonces must produce distinct ciphertexts");
        assert_eq!(cipher.decrypt(&enc1).expect("decrypt 1"), secret);
        assert_eq!(cipher.decrypt(&enc2).expect("decrypt 2"), secret);

        let hex_key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let hex_cipher = TokenCipher::from_encoded_key(hex_key).expect("valid hex key");
        let enc_hex = hex_cipher.encrypt("refresh-token").expect("encrypt hex");
        assert_eq!(hex_cipher.decrypt(&enc_hex).expect("decrypt hex"), "refresh-token");
    }

    #[test]
    fn wrong_key_and_tampered_ciphertext_fail() {
        let c1 = TokenCipher::from_encoded_key(&TokenCipher::generate_random_key_b64()).unwrap();
        let c2 = TokenCipher::from_encoded_key(&TokenCipher::generate_random_key_b64()).unwrap();
        let enc = c1.encrypt("secret-token").unwrap();

        assert!(matches!(c2.decrypt(&enc), Err(CryptoError::DecryptFailed)));
        assert!(matches!(
            c1.decrypt("not-versioned"),
            Err(CryptoError::InvalidCiphertext)
        ));

        let mut tampered = enc.clone();
        let last = tampered.pop().unwrap();
        tampered.push(if last == 'A' { 'B' } else { 'A' });
        assert!(c1.decrypt(&tampered).is_err());
    }
}
