import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv

project_root = Path(__file__).resolve().parent.parent.parent
load_dotenv(project_root / ".env", override=True)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")
    DEBUG: bool = False
    PROJECT_NAME: str = "CRAFT"
    API_HOST: str = os.getenv("CRAFT_HOST", "127.0.0.1")
    API_PORT: int = int(os.getenv("CRAFT_PORT", "8000"))
    BASE_DIR: Path = project_root / "backend"
    DATA_DIR: Path = Path(os.getenv("CRAFT_DATA_DIR", str(BASE_DIR / "data")))
    PUPIL_HOST: str = "127.0.0.1"
    PUPIL_PORT: int = 50020


settings = Settings()
settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
