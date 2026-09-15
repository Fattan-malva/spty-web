import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.application:app", host="0.0.0.0", port=1404, workers=1)