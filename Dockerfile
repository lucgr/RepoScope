# Use an official Python runtime as a parent image
FROM python:3.9-slim

# Set the working directory in the container
WORKDIR /app

# Install system dependencies including git
# 1. Resynchronize the package index files from their sources.
# 2. Install git without prompting for confirmation.
# 3. Avoids installing recommended packages, keeping the image smaller.
# 4. Clean up apt cache to reduce image size.
RUN apt-get update && \
    apt-get install -y git --no-install-recommends && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Configure git user details for commits made within the container
# TODO: Make this configurable
RUN git config --global user.email "lucasgether@gmail.com" && \ 
    git config --global user.name "Workspace Bot"

# Copy the requirements file into the container at /app
COPY backend/requirements.txt .

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire backend directory AS A SUBDIRECTORY into /app
# This ensures that this subdirectory is treated as the main package
COPY backend /app/service_code

# Make port 8080 available
EXPOSE 8080

# ENV PORT 8000 is fine, Cloud Run will override with its own PORT (usually 8080)
ENV PORT 8000

# Run main.py when the container launches
# The application is now 'service_code.main:app'
# Uvicorn is run from WORKDIR /app, so Python can find the 'service_code' package.
CMD exec uvicorn service_code.main:app --host 0.0.0.0 --port ${PORT:-8080} 