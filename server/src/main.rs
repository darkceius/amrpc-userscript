use axum::{Json, Router, extract::State, routing::post};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient, activity};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::time::sleep;

const APP_ID: &str = "1477020493365252260";

#[derive(Deserialize)]
struct Assets {
    large_image: Option<String>,
    large_text: Option<String>,
}

#[derive(Deserialize)]
struct Timestamps {
    start: Option<i64>,
    end: Option<i64>,
}

#[derive(Deserialize)]
struct Button {
    label: String,
    url: String,
}

#[derive(Deserialize)]
struct SetActivityPayload {
    details: Option<String>,
    state: Option<String>,
    assets: Option<Assets>,
    timestamps: Option<Timestamps>,
    buttons: Option<Vec<Button>>,
}

struct AppState {
    client: DiscordIpcClient,
    last_ping: Option<u64>,
}

#[derive(Serialize)]
struct ResponseBody {
    success: bool,
}

#[tokio::main]
async fn main() {
    let mut client = DiscordIpcClient::new(APP_ID);
    client.connect().expect("Failed to connect to Discord");

    let shared_state = Arc::new(Mutex::new(AppState {
        client,
        last_ping: None,
    }));

    let monitor_state = Arc::clone(&shared_state);
    tokio::spawn(async move {
        loop {
            sleep(Duration::from_secs(1)).await;
            let mut state = monitor_state.lock().unwrap();

            if let Some(last_ping_time) = state.last_ping {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs();

                if now - last_ping_time > 10 {
                    let _ = state.client.clear_activity();
                    state.last_ping = None;
                }
            }
        }
    });

    let app = Router::new()
        .route("/set", post(set_activity))
        .route("/clear", post(clear_activity))
        .with_state(shared_state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:7635").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn set_activity(
    State(state): State<Arc<Mutex<AppState>>>,
    Json(payload): Json<SetActivityPayload>,
) -> Json<ResponseBody> {
    let mut state = state.lock().unwrap();

    state.last_ping = Some(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    );

    let mut activity = activity::Activity::new()
        .activity_type(activity::ActivityType::Listening)
        .status_display_type(activity::StatusDisplayType::State);

    if let Some(d) = payload.details.as_deref() {
        activity = activity.details(d);
    }
    if let Some(s) = payload.state.as_deref() {
        activity = activity.state(s);
    }

    let mut assets = activity::Assets::new();
    if let Some(ref a) = payload.assets {
        if let Some(img) = a.large_image.as_deref() {
            assets = assets.large_image(img);
        }
        if let Some(txt) = a.large_text.as_deref() {
            assets = assets.large_text(txt);
        }
        activity = activity.assets(assets);
    }

    let mut timestamps = activity::Timestamps::new();
    if let Some(ref t) = payload.timestamps {
        if let Some(start) = t.start {
            timestamps = timestamps.start(start);
        }
        if let Some(end) = t.end {
            timestamps = timestamps.end(end);
        }
        activity = activity.timestamps(timestamps);
    }

    let mut buttons = Vec::new();
    if let Some(ref payload_buttons) = payload.buttons {
        for b in payload_buttons {
            buttons.push(activity::Button::new(&b.label, &b.url));
        }
        activity = activity.buttons(buttons);
    }

    match state.client.set_activity(activity) {
        Ok(_) => Json(ResponseBody { success: true }),
        Err(_) => Json(ResponseBody { success: false }),
    }
}

async fn clear_activity(State(state): State<Arc<Mutex<AppState>>>) -> Json<ResponseBody> {
    let mut state = state.lock().unwrap();
    state.last_ping = None;
    match state.client.clear_activity() {
        Ok(_) => Json(ResponseBody { success: true }),
        Err(_) => Json(ResponseBody { success: false }),
    }
}
