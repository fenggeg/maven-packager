use crate::error::{to_user_error, AppResult};
use crate::repositories::deployment_repo::ExecutionServerProfile;
use encoding_rs::GBK;
use ssh2::Session;
use std::fs::File;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;

pub struct CommandResult {
    pub output: String,
    pub exit_status: i32,
}

/// A reusable SSH connection that avoids creating new TCP+handshake+auth for each command.
pub struct SshConnection {
    session: Session,
}

impl SshConnection {
    /// Opens an SSH connection once (password or private_key), reusable for all subsequent operations.
    pub fn connect(profile: &ExecutionServerProfile) -> AppResult<Self> {
        let session = match profile.auth_type.as_str() {
            "password" => {
                if profile.password.as_deref().is_none_or(|value| value.trim().is_empty()) {
                    return Err(to_user_error("服务器密码不存在。"));
                }
                open_password_session(profile)?
            }
            "private_key" => {
                let key_path = profile
                    .private_key_path
                    .as_deref()
                    .ok_or_else(|| to_user_error("私钥认证需要提供私钥路径。"))?;
                if !Path::new(key_path).exists() {
                    return Err(to_user_error("私钥文件不存在。"));
                }
                open_private_key_session(profile)?
            }
            _ => return Err(to_user_error("暂不支持的认证方式。")),
        };
        Ok(Self { session })
    }

    /// Execute a remote command with cancellation support.
    /// Uses session timeout to periodically check cancellation.
    pub fn execute_with_cancel<C>(
        &self,
        command: &str,
        mut is_cancelled: C,
    ) -> AppResult<CommandResult>
    where
        C: FnMut() -> bool,
    {
        self.execute_allowing_status(command, &[], &mut is_cancelled)
    }

    /// Execute a remote command and treat the provided exit codes as successful.
    pub fn execute_allowing_status<C>(
        &self,
        command: &str,
        success_exit_codes: &[i32],
        mut is_cancelled: C,
    ) -> AppResult<CommandResult>
    where
        C: FnMut() -> bool,
    {
        if is_cancelled() {
            return Err(to_user_error("部署已停止。"));
        }

        let mut channel = self
            .session
            .channel_session()
            .map_err(|error| to_user_error(format!("无法打开 SSH 命令通道：{}", error)))?;
        channel
            .exec(command)
            .map_err(|error| to_user_error(format!("远端命令执行失败：{}", error)))?;

        // Use a short timeout so we can check cancellation periodically
        self.session.set_timeout(500);

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut buf = [0u8; 8192];

        loop {
            if is_cancelled() {
                let _ = channel.close();
                self.session.set_timeout(0);
                return Err(to_user_error("部署已停止。"));
            }

            // Read stdout
            match channel.read(&mut buf) {
                Ok(0) | Err(_) if channel.eof() => {
                    // Channel closed
                }
                Ok(n) => stdout.extend_from_slice(&buf[..n]),
                Err(e)
                    if e.kind() == std::io::ErrorKind::TimedOut
                        || e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => {
                    self.session.set_timeout(0);
                    return Err(to_user_error(format!("读取命令输出失败：{}", e)));
                }
            }

            // Read stderr
            match channel.stderr().read(&mut buf) {
                Ok(0) | Err(_) if channel.eof() => {}
                Ok(n) => stderr.extend_from_slice(&buf[..n]),
                Err(e)
                    if e.kind() == std::io::ErrorKind::TimedOut
                        || e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => {
                    self.session.set_timeout(0);
                    return Err(to_user_error(format!("读取命令错误输出失败：{}", e)));
                }
            }

            if channel.eof() {
                break;
            }
        }

        self.session.set_timeout(0); // Reset to infinite

        let exit_status = channel
            .exit_status()
            .map_err(|error| to_user_error(format!("读取远端命令退出码失败：{}", error)))?;

        parse_command_bytes(stdout, stderr, exit_status, success_exit_codes, "远端命令执行失败")
    }

    /// Upload a file via SCP with progress reporting and cancellation support.
    pub fn upload_file_with_progress<C, P>(
        &self,
        local_path: &Path,
        remote_path: &str,
        mut is_cancelled: C,
        mut on_progress: P,
    ) -> AppResult<()>
    where
        C: FnMut() -> bool,
        P: FnMut(u64, u64),
    {
        if !local_path.exists() {
            return Err(to_user_error("本地产物不存在。"));
        }

        let mut local_file = File::open(local_path)
            .map_err(|error| to_user_error(format!("无法打开本地产物：{}", error)))?;
        let file_size = local_file
            .metadata()
            .map_err(|error| to_user_error(format!("无法读取本地产物信息：{}", error)))?
            .len();
        let mut remote_file = self
            .session
            .scp_send(Path::new(remote_path), 0o644, file_size, None)
            .map_err(|error| to_user_error(format!("无法创建远端上传文件：{}", error)))?;

        let mut uploaded = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        on_progress(uploaded, file_size);
        loop {
            if is_cancelled() {
                return Err(to_user_error("部署已停止。"));
            }

            let read = local_file
                .read(&mut buffer)
                .map_err(|error| to_user_error(format!("读取本地产物失败：{}", error)))?;
            if read == 0 {
                break;
            }

            remote_file
                .write_all(&buffer[..read])
                .map_err(|error| to_user_error(format!("上传产物失败：{}", error)))?;
            uploaded += read as u64;
            on_progress(uploaded, file_size);
        }

        remote_file
            .send_eof()
            .map_err(|error| to_user_error(format!("结束上传失败：{}", error)))?;
        remote_file
            .wait_eof()
            .map_err(|error| to_user_error(format!("等待远端接收失败：{}", error)))?;
        remote_file
            .close()
            .map_err(|error| to_user_error(format!("关闭远端上传文件失败：{}", error)))?;
        remote_file
            .wait_close()
            .map_err(|error| to_user_error(format!("确认远端上传结果失败：{}", error)))?;
        Ok(())
    }
}

// --- Internal helpers ---

fn open_password_session(profile: &ExecutionServerProfile) -> AppResult<Session> {
    let password = profile
        .password
        .as_deref()
        .ok_or_else(|| to_user_error("服务器密码不存在。"))?;
    let tcp = TcpStream::connect((profile.host.as_str(), profile.port))
        .map_err(|error| to_user_error(format!("无法连接 SSH 服务器：{}", error)))?;
    let _ = tcp.set_read_timeout(Some(Duration::from_secs(30)));
    let _ = tcp.set_write_timeout(Some(Duration::from_secs(30)));

    let mut session = Session::new()
        .map_err(|error| to_user_error(format!("无法创建 SSH 会话：{}", error)))?;
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|error| to_user_error(format!("SSH 握手失败：{}", error)))?;
    session
        .userauth_password(&profile.username, password)
        .map_err(|error| to_user_error(format!("SSH 密码认证失败：{}", error)))?;
    if !session.authenticated() {
        return Err(to_user_error("SSH 密码认证失败，请检查用户名或密码。"));
    }
    Ok(session)
}

fn open_private_key_session(profile: &ExecutionServerProfile) -> AppResult<Session> {
    let key_path = profile
        .private_key_path
        .as_deref()
        .ok_or_else(|| to_user_error("私钥认证需要提供私钥路径。"))?;
    let tcp = TcpStream::connect((profile.host.as_str(), profile.port))
        .map_err(|error| to_user_error(format!("无法连接 SSH 服务器：{}", error)))?;
    let _ = tcp.set_read_timeout(Some(Duration::from_secs(30)));
    let _ = tcp.set_write_timeout(Some(Duration::from_secs(30)));

    let mut session = Session::new()
        .map_err(|error| to_user_error(format!("无法创建 SSH 会话：{}", error)))?;
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|error| to_user_error(format!("SSH 握手失败：{}", error)))?;
    session
        .userauth_pubkey_file(&profile.username, None, Path::new(key_path), None)
        .map_err(|error| to_user_error(format!("SSH 私钥认证失败：{}", error)))?;
    if !session.authenticated() {
        return Err(to_user_error("SSH 私钥认证失败，请检查用户名或私钥。"));
    }
    Ok(session)
}

fn parse_command_bytes(
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    exit_status: i32,
    success_exit_codes: &[i32],
    fallback: &str,
) -> AppResult<CommandResult> {
    let combined = format!("{}{}", decode_output(&stdout), decode_output(&stderr))
        .trim()
        .to_string();
    let success_codes = if success_exit_codes.is_empty() {
        &[0][..]
    } else {
        success_exit_codes
    };
    if !success_codes.contains(&exit_status) {
        return Err(to_user_error(if combined.is_empty() {
            fallback.to_string()
        } else {
            combined
        }));
    }
    Ok(CommandResult {
        output: combined,
        exit_status,
    })
}

fn decode_output(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    String::from_utf8(bytes.to_vec()).unwrap_or_else(|_| {
        let (value, _, _) = GBK.decode(bytes);
        value.into_owned()
    })
}
