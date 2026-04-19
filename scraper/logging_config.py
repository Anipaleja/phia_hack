"""
Logging configuration for the scraper.
"""
import structlog
import logging
from typing import Optional


def configure_logging(level: str = "INFO", log_file: Optional[str] = None) -> None:
    """
    Configure structured logging for the scraper.
    
    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_file: Optional file path to log to
    """
    # Configure standard library logging
    logging.basicConfig(
        level=level,
        format="%(message)s",
    )
    
    # Configure structlog
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.processors.JSONRenderer(),
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str):
    """Get a logger instance."""
    return structlog.get_logger(name)
