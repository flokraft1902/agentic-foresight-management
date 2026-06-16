from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    llm_api_key: str | None = None
    llm_model: str = "openrouter/nex-agi/nex-n2-pro:free"
    app_host: str = "127.0.0.1"
    app_port: int = 8000
    data_dir: str = "./data"
    default_focus: str = (
        "Weak signals in the energy economy with impact on policy, security, and sustainability."
    )
    default_search_terms: str = (
        "hydrogen import germany,energy storage solid state battery,electricity market reform eu,"
        "capacity market germany,grid congestion europe,co2 certificate price trend,"
        "vehicle to grid pilot,industrial demand response,renewable curtailment,"
        "offshore wind supply chain"
    )


settings = Settings()
