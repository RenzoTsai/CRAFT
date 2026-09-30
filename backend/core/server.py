from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings


def create_app() -> FastAPI:
    """
    Create and configure the FastAPI application
    """
    app = FastAPI(
        title=settings.PROJECT_NAME,
        debug=settings.DEBUG,
    )

    # Set up CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],  # Specific origin instead of "*"
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    return app