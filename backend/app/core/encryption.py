from cryptography.fernet import Fernet
from config import get_settings


def _get_fernet() -> Fernet:
    return Fernet(get_settings().encryption_key.encode())


def encrypt_api_key(plain: str) -> str:
    return _get_fernet().encrypt(plain.encode()).decode()


def decrypt_api_key(token: str) -> str:
    return _get_fernet().decrypt(token.encode()).decode()
