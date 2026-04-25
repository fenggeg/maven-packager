use crate::error::AppResult;
use crate::models::deployment::{DeploymentProfile, DeploymentTask, SaveServerProfilePayload, ServerProfile};
use crate::repositories::storage::open_database;
use crate::services::secure_storage;
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredServerProfile {
    id: String,
    name: String,
    host: String,
    port: u16,
    username: String,
    auth_type: String,
    encrypted_password: Option<String>,
    private_key_path: Option<String>,
    group: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
}

pub fn list_server_profiles(app: &AppHandle) -> AppResult<Vec<ServerProfile>> {
    let connection = open_database(app)?;
    let mut statement = connection
        .prepare("SELECT payload FROM server_profiles ORDER BY updated_at DESC, name ASC")
        .map_err(|error| format!("无法读取服务器配置：{}", error))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("无法读取服务器配置：{}", error))?;

    let mut profiles = Vec::new();
    for row in rows {
        let payload = row.map_err(|error| format!("无法读取服务器配置：{}", error))?;
        let stored: StoredServerProfile = serde_json::from_str(&payload)
            .map_err(|error| format!("服务器配置数据格式异常：{}", error))?;
        profiles.push(to_public_server_profile(stored));
    }

    Ok(profiles)
}

pub fn save_server_profile(
    app: &AppHandle,
    payload: SaveServerProfilePayload,
) -> AppResult<ServerProfile> {
    let connection = open_database(app)?;
    let id = payload.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339();
    let existing = load_stored_server_profile(app, &id).ok();

    let encrypted_password = if payload.auth_type == "password" {
        match payload.password.as_deref() {
            Some(password) if !password.trim().is_empty() => {
                Some(secure_storage::encrypt_string(password.trim())?)
            }
            _ => existing
                .as_ref()
                .and_then(|item| item.encrypted_password.clone())
                .filter(|value| !value.trim().is_empty()),
        }
    } else {
        None
    };

    if payload.auth_type == "password" && encrypted_password.is_none() {
        return Err("密码认证需要填写密码。".to_string());
    }

    let stored = StoredServerProfile {
        id: id.clone(),
        name: payload.name.trim().to_string(),
        host: payload.host.trim().to_string(),
        port: payload.port,
        username: payload.username.trim().to_string(),
        auth_type: payload.auth_type,
        encrypted_password,
        private_key_path: payload
            .private_key_path
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        group: payload
            .group
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        created_at: existing
            .as_ref()
            .and_then(|item| item.created_at.clone())
            .or_else(|| Some(now.clone())),
        updated_at: Some(now),
    };

    let content = serde_json::to_string(&stored)
        .map_err(|error| format!("无法序列化服务器配置：{}", error))?;
    connection
        .execute(
            r#"
            INSERT INTO server_profiles (id, name, created_at, updated_at, payload)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                payload = excluded.payload
            "#,
            params![
                stored.id,
                stored.name,
                stored.created_at,
                stored.updated_at,
                content
            ],
        )
        .map_err(|error| format!("无法保存服务器配置：{}", error))?;

    Ok(to_public_server_profile(stored))
}

pub fn delete_server_profile(app: &AppHandle, server_id: &str) -> AppResult<()> {
    let connection = open_database(app)?;
    connection
        .execute("DELETE FROM server_profiles WHERE id = ?1", params![server_id])
        .map_err(|error| format!("无法删除服务器配置：{}", error))?;
    Ok(())
}

pub fn list_deployment_profiles(app: &AppHandle) -> AppResult<Vec<DeploymentProfile>> {
    let connection = open_database(app)?;
    let mut statement = connection
        .prepare("SELECT payload FROM deployment_profiles ORDER BY updated_at DESC, name ASC")
        .map_err(|error| format!("无法读取部署配置：{}", error))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("无法读取部署配置：{}", error))?;

    let mut profiles = Vec::new();
    for row in rows {
        let payload = row.map_err(|error| format!("无法读取部署配置：{}", error))?;
        let profile = serde_json::from_str(&payload)
            .map_err(|error| format!("部署配置数据格式异常：{}", error))?;
        profiles.push(profile);
    }
    Ok(profiles)
}

pub fn save_deployment_profile(
    app: &AppHandle,
    mut profile: DeploymentProfile,
) -> AppResult<DeploymentProfile> {
    let connection = open_database(app)?;
    let now = Utc::now().to_rfc3339();
    let existing: Option<String> = connection
        .query_row(
            "SELECT created_at FROM deployment_profiles WHERE id = ?1",
            params![profile.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("无法读取部署配置：{}", error))?;

    profile.created_at = existing.or_else(|| Some(now.clone()));
    profile.updated_at = Some(now);
    let payload = serde_json::to_string(&profile)
        .map_err(|error| format!("无法序列化部署配置：{}", error))?;
    connection
        .execute(
            r#"
            INSERT INTO deployment_profiles (id, name, created_at, updated_at, payload)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                payload = excluded.payload
            "#,
            params![
                profile.id,
                profile.name,
                profile.created_at,
                profile.updated_at,
                payload
            ],
        )
        .map_err(|error| format!("无法保存部署配置：{}", error))?;

    Ok(profile)
}

pub fn delete_deployment_profile(app: &AppHandle, profile_id: &str) -> AppResult<()> {
    let connection = open_database(app)?;
    connection
        .execute(
            "DELETE FROM deployment_profiles WHERE id = ?1",
            params![profile_id],
        )
        .map_err(|error| format!("无法删除部署配置：{}", error))?;
    Ok(())
}

pub fn list_deployment_tasks(app: &AppHandle) -> AppResult<Vec<DeploymentTask>> {
    let connection = open_database(app)?;
    let mut statement = connection
        .prepare("SELECT payload FROM deployment_tasks ORDER BY created_at DESC")
        .map_err(|error| format!("无法读取部署历史：{}", error))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("无法读取部署历史：{}", error))?;

    let mut tasks = Vec::new();
    for row in rows {
        let payload = row.map_err(|error| format!("无法读取部署历史：{}", error))?;
        let task = serde_json::from_str(&payload)
            .map_err(|error| format!("部署历史数据格式异常：{}", error))?;
        tasks.push(task);
    }
    Ok(tasks)
}

pub fn save_deployment_task(app: &AppHandle, task: DeploymentTask) -> AppResult<()> {
    let connection = open_database(app)?;
    let payload = serde_json::to_string(&task)
        .map_err(|error| format!("无法序列化部署历史：{}", error))?;
    connection
        .execute(
            r#"
            INSERT INTO deployment_tasks (id, deployment_profile_id, created_at, payload)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(id) DO UPDATE SET
                deployment_profile_id = excluded.deployment_profile_id,
                created_at = excluded.created_at,
                payload = excluded.payload
            "#,
            params![task.id, task.deployment_profile_id, task.created_at, payload],
        )
        .map_err(|error| format!("无法保存部署历史：{}", error))?;

    connection
        .execute(
            r#"
            DELETE FROM deployment_tasks
            WHERE id NOT IN (
                SELECT id FROM deployment_tasks
                ORDER BY created_at DESC
                LIMIT 100
            )
            "#,
            [],
        )
        .map_err(|error| format!("无法清理部署历史：{}", error))?;
    Ok(())
}

pub fn delete_deployment_task(app: &AppHandle, task_id: &str) -> AppResult<()> {
    let connection = open_database(app)?;
    connection
        .execute("DELETE FROM deployment_tasks WHERE id = ?1", params![task_id])
        .map_err(|error| format!("无法删除部署记录：{}", error))?;
    Ok(())
}

pub fn get_deployment_profile(app: &AppHandle, profile_id: &str) -> AppResult<DeploymentProfile> {
    let connection = open_database(app)?;
    let payload: String = connection
        .query_row(
            "SELECT payload FROM deployment_profiles WHERE id = ?1",
            params![profile_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("无法读取部署配置：{}", error))?;
    serde_json::from_str(&payload).map_err(|error| format!("部署配置数据格式异常：{}", error))
}

pub fn get_server_profile_for_execution(
    app: &AppHandle,
    server_id: &str,
) -> AppResult<ExecutionServerProfile> {
    let stored = load_stored_server_profile(app, server_id)?;
    let password = stored
        .encrypted_password
        .as_deref()
        .map(secure_storage::decrypt_string)
        .transpose()?;
    Ok(ExecutionServerProfile {
        id: stored.id,
        name: stored.name,
        host: stored.host,
        port: stored.port,
        username: stored.username,
        auth_type: stored.auth_type,
        password,
        private_key_path: stored.private_key_path,
    })
}

#[derive(Debug, Clone)]
pub struct ExecutionServerProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
}

fn load_stored_server_profile(app: &AppHandle, server_id: &str) -> AppResult<StoredServerProfile> {
    let connection = open_database(app)?;
    let payload: String = connection
        .query_row(
            "SELECT payload FROM server_profiles WHERE id = ?1",
            params![server_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("无法读取服务器配置：{}", error))?;
    serde_json::from_str(&payload).map_err(|error| format!("服务器配置数据格式异常：{}", error))
}

fn to_public_server_profile(stored: StoredServerProfile) -> ServerProfile {
    ServerProfile {
        id: stored.id,
        name: stored.name,
        host: stored.host,
        port: stored.port,
        username: stored.username,
        auth_type: stored.auth_type,
        private_key_path: stored.private_key_path,
        group: stored.group,
        password_configured: stored
            .encrypted_password
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty()),
        created_at: stored.created_at,
        updated_at: stored.updated_at,
    }
}
