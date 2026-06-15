from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    football_data_key: str
    football_data_base_url: str = "https://api.football-data.org/v4"
    odds_api_key: str = ""
    backend_port: int = 8000
    environment: str = "development"

    class Config:
        env_file = ".env"

settings = Settings()
