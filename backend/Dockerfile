FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY fileaction /app/fileaction
COPY alembic.ini /app/alembic.ini
COPY migrations /app/migrations
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "fileaction.api.application:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
