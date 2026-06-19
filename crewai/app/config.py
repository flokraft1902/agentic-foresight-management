from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    llm_api_key: str | None = None
    llm_model: str = "openrouter/nex-agi/nex-n2-pro:free"
    # How many per-case LLM calls run in parallel in the Assessment and Expert
    # stages. Higher = faster runs, but watch provider rate limits.
    llm_max_workers: int = 5
    app_host: str = "127.0.0.1"
    app_port: int = 8000
    data_dir: str = "./data"
    # Comma-separated list of allowed browser origins for CORS. Defaults to the
    # local Next.js dev server. A wildcard "*" cannot be combined with
    # credentials, so we name the origin explicitly.
    cors_allow_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
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
