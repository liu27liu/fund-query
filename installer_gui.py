"""
Fund Stock Query - GUI Installer
A proper Windows installer with wizard UI, install location selection,
desktop shortcut, start menu, and uninstaller.
Auto-elevates to admin when needed (e.g. Program Files).
"""
import os
import sys
import shutil
import tkinter as tk
from tkinter import filedialog, ttk, messagebox
import subprocess
import json
import ctypes


def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False


def needs_admin(path):
    """Check if path likely needs admin privileges"""
    path_lower = path.lower().replace("/", "\\")
    system_dirs = ["\\program files", "\\program files (x86)", "\\windows", "\\programdata"]
    for d in system_dirs:
        if d in path_lower:
            return True
    return False


def relaunch_as_admin():
    """Relaunch the installer with admin privileges"""
    params = " ".join([f'"{sys.argv[0]}"'] + sys.argv[1:])
    try:
        ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, params, None, 1)
        sys.exit(0)
    except:
        pass


class InstallerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Fund Stock Query - Setup")
        self.root.geometry("540x460")
        self.root.resizable(False, False)

        # Center window
        self.root.update_idletasks()
        x = (self.root.winfo_screenwidth() - 540) // 2
        y = (self.root.winfo_screenheight() - 460) // 2
        self.root.geometry(f"+{x}+{y}")

        # Default install to user directory (no admin needed)
        self.install_dir = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "Programs", "FundStockQuery")
        self.create_desktop_shortcut = tk.BooleanVar(value=True)
        self.create_start_menu = tk.BooleanVar(value=True)
        self.launch_after = tk.BooleanVar(value=True)

        self.show_welcome()

    def clear_frame(self):
        for widget in self.root.winfo_children():
            widget.destroy()

    def show_welcome(self):
        self.clear_frame()

        frame = tk.Frame(self.root, padx=40, pady=30)
        frame.pack(fill="both", expand=True)

        tk.Label(frame, text="", font=("Segoe UI", 8)).pack(pady=(0, 5))

        # Logo area
        logo_label = tk.Label(frame, text="\U0001F4C8", font=("Segoe UI", 40))
        logo_label.pack(pady=(0, 5))

        tk.Label(frame, text="Fund Stock Query", font=("Segoe UI", 22, "bold"), fg="#1a237e").pack()
        tk.Label(frame, text="Version 1.0.0", font=("Segoe UI", 11), fg="#666").pack(pady=(5, 15))

        info_text = (
            "Comprehensive fund and stock query platform\n"
            "\n"
            "  - Real-time fund valuation\n"
            "  - A-share market data\n"
            "  - Capital flow tracking\n"
            "  - Fund portfolio analysis\n"
        )
        tk.Label(frame, text=info_text, font=("Segoe UI", 10), justify="left", fg="#333").pack()

        btn_frame = tk.Frame(frame)
        btn_frame.pack(side="bottom", fill="x", pady=(20, 0))

        tk.Button(btn_frame, text="Cancel", width=10, command=self.root.quit,
                  font=("Segoe UI", 10)).pack(side="right", padx=(5, 0))
        tk.Button(btn_frame, text="Next >", width=10, command=self.show_location,
                  font=("Segoe UI", 10), bg="#1a237e", fg="white").pack(side="right")

    def show_location(self):
        self.clear_frame()

        frame = tk.Frame(self.root, padx=40, pady=30)
        frame.pack(fill="both", expand=True)

        tk.Label(frame, text="Select Install Location", font=("Segoe UI", 16, "bold"), fg="#1a237e").pack(anchor="w")
        tk.Label(frame, text="Choose the folder where to install Fund Stock Query.",
                 font=("Segoe UI", 10), fg="#666").pack(anchor="w", pady=(5, 20))

        path_frame = tk.Frame(frame)
        path_frame.pack(fill="x")

        self.path_var = tk.StringVar(value=self.install_dir)
        self.path_entry = tk.Entry(path_frame, textvariable=self.path_var,
                                    font=("Segoe UI", 10), width=44)
        self.path_entry.pack(side="left", padx=(0, 5))

        tk.Button(path_frame, text="Browse...", command=self.browse_folder,
                  font=("Segoe UI", 9)).pack(side="left")

        # Warning label for admin paths
        self.warning_label = tk.Label(frame, text="", font=("Segoe UI", 9), fg="#e65100", wraplength=440)
        self.warning_label.pack(anchor="w", pady=(10, 0))

        # Options
        tk.Label(frame, text="", font=("Segoe UI", 8)).pack(pady=(10, 0))
        tk.Checkbutton(frame, text="Create desktop shortcut", variable=self.create_desktop_shortcut,
                       font=("Segoe UI", 10)).pack(anchor="w", pady=2)
        tk.Checkbutton(frame, text="Create Start Menu shortcut", variable=self.create_start_menu,
                       font=("Segoe UI", 10)).pack(anchor="w", pady=2)
        tk.Checkbutton(frame, text="Launch after installation", variable=self.launch_after,
                       font=("Segoe UI", 10)).pack(anchor="w", pady=2)

        # Disk space info
        space_frame = tk.Frame(frame)
        space_frame.pack(fill="x", pady=(15, 0))
        tk.Label(space_frame, text="Required space: ~80 MB", font=("Segoe UI", 9), fg="#666").pack(side="left")

        btn_frame = tk.Frame(frame)
        btn_frame.pack(side="bottom", fill="x", pady=(15, 0))

        tk.Button(btn_frame, text="< Back", width=10, command=self.show_welcome,
                  font=("Segoe UI", 10)).pack(side="left")
        tk.Button(btn_frame, text="Cancel", width=10, command=self.root.quit,
                  font=("Segoe UI", 10)).pack(side="right", padx=(5, 0))
        tk.Button(btn_frame, text="Install", width=10, command=self.check_and_install,
                  font=("Segoe UI", 10), bg="#1a237e", fg="white").pack(side="right")

        self.check_path_permission()

    def browse_folder(self):
        folder = filedialog.askdirectory(initialdir=self.install_dir, title="Select Install Folder")
        if folder:
            self.install_dir = folder
            self.path_var.set(folder)
            self.check_path_permission()

    def check_path_permission(self):
        """Check if the selected path needs admin privileges"""
        path = self.path_var.get()
        if needs_admin(path) and not is_admin():
            self.warning_label.config(
                text="This location requires administrator privileges. The installer will request elevation when you click Install."
            )
        else:
            self.warning_label.config(text="")

    def check_and_install(self):
        self.install_dir = self.path_var.get()

        # Check if needs admin and we don't have it
        if needs_admin(self.install_dir) and not is_admin():
            # Save install info before elevation
            self.save_install_config()
            # Relaunch as admin
            messagebox.showinfo("Elevation Required",
                                "This install location requires administrator privileges.\n"
                                "The installer will now restart with elevated privileges.")
            relaunch_as_admin()
            return

        self.show_progress()

    def save_install_config(self):
        """Save config so elevated instance can read it"""
        config = {
            "install_dir": self.install_dir,
            "desktop": self.create_desktop_shortcut.get(),
            "start_menu": self.create_start_menu.get(),
            "launch": self.launch_after.get(),
        }
        config_path = os.path.join(os.environ.get("TEMP", "."), "fundquery_install.json")
        with open(config_path, "w") as f:
            json.dump(config, f)

    def load_install_config(self):
        """Load saved config (from non-elevated instance)"""
        config_path = os.path.join(os.environ.get("TEMP", "."), "fundquery_install.json")
        if os.path.exists(config_path):
            try:
                with open(config_path, "r") as f:
                    config = json.load(f)
                self.install_dir = config.get("install_dir", self.install_dir)
                self.create_desktop_shortcut.set(config.get("desktop", True))
                self.create_start_menu.set(config.get("start_menu", True))
                self.launch_after.set(config.get("launch", True))
                os.remove(config_path)
                return True
            except:
                pass
        return False

    def show_progress(self):
        self.clear_frame()

        frame = tk.Frame(self.root, padx=40, pady=30)
        frame.pack(fill="both", expand=True)

        tk.Label(frame, text="Installing...", font=("Segoe UI", 16, "bold"), fg="#1a237e").pack(anchor="w")
        tk.Label(frame, text=self.install_dir, font=("Segoe UI", 9), fg="#666").pack(anchor="w", pady=(5, 20))

        self.progress = ttk.Progressbar(frame, length=420, mode="determinate")
        self.progress.pack(pady=10)

        self.status_label = tk.Label(frame, text="Preparing...", font=("Segoe UI", 10), fg="#333")
        self.status_label.pack(pady=5)

        btn_frame = tk.Frame(frame)
        btn_frame.pack(side="bottom", fill="x", pady=(20, 0))

        self.cancel_btn = tk.Button(btn_frame, text="Cancel", width=10, command=self.root.quit,
                                    font=("Segoe UI", 10), state="disabled")
        self.cancel_btn.pack(side="right")

        # Start installation in background
        self.root.after(100, self.do_install)

    def update_progress(self, value, status):
        self.progress["value"] = value
        self.status_label.config(text=status)
        self.root.update_idletasks()

    def do_install(self):
        try:
            src_exe = self.get_source_exe()

            # Step 1: Create directory
            self.update_progress(10, "Creating directory...")
            os.makedirs(self.install_dir, exist_ok=True)

            # Step 2: Copy exe
            self.update_progress(30, "Copying application files...")
            dst_exe = os.path.join(self.install_dir, "FundStockQuery.exe")

            # Kill if running
            subprocess.run(["taskkill", "/F", "/IM", "FundStockQuery.exe"],
                           capture_output=True, timeout=5)
            time.sleep(0.5)

            shutil.copy2(src_exe, dst_exe)

            # Step 3: Create uninstaller
            self.update_progress(50, "Creating uninstaller...")
            self.create_uninstaller()

            # Step 4: Desktop shortcut
            if self.create_desktop_shortcut.get():
                self.update_progress(65, "Creating desktop shortcut...")
                self.create_shortcut("Desktop")

            # Step 5: Start menu
            if self.create_start_menu.get():
                self.update_progress(80, "Creating Start Menu shortcut...")
                self.create_shortcut("StartMenu")

            # Step 6: Register uninstall
            self.update_progress(90, "Registering in Windows...")
            self.register_uninstall()

            self.update_progress(100, "Installation complete!")
            self.root.after(500, self.show_finish)

        except Exception as e:
            self.status_label.config(text=f"Error: {e}", fg="red")
            self.cancel_btn.config(state="normal", text="Close", command=self.root.quit)

    def get_source_exe(self):
        """Find FundStockQuery.exe - from bundled resources (PyInstaller) or next to installer"""
        # PyInstaller: extract from _MEIPASS
        if getattr(sys, 'frozen', False):
            bundled = os.path.join(sys._MEIPASS, "FundStockQuery.exe")
            if os.path.exists(bundled):
                return bundled

        # Next to installer exe
        exe_dir = os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else os.path.dirname(__file__)
        exe_path = os.path.join(exe_dir, "FundStockQuery.exe")
        if os.path.exists(exe_path):
            return exe_path

        # Current working directory
        exe_path = os.path.join(os.getcwd(), "FundStockQuery.exe")
        if os.path.exists(exe_path):
            return exe_path

        raise FileNotFoundError("FundStockQuery.exe not found.")

    def create_shortcut(self, location):
        """Create a .lnk shortcut using PowerShell"""
        target = os.path.join(self.install_dir, "FundStockQuery.exe")
        icon = f"{target},0"

        if location == "Desktop":
            shortcut_dir = os.path.join(os.environ.get("USERPROFILE", ""), "Desktop")
        else:
            shortcut_dir = os.path.join(os.environ.get("APPDATA", ""),
                                         "Microsoft", "Windows", "Start Menu", "Programs", "Fund Stock Query")
            os.makedirs(shortcut_dir, exist_ok=True)

        shortcut_path = os.path.join(shortcut_dir, "净值通.lnk")

        ps_cmd = (
            f'$ws = New-Object -ComObject WScript.Shell; '
            f'$sc = $ws.CreateShortcut("{shortcut_path}"); '
            f'$sc.TargetPath = "{target}"; '
            f'$sc.IconLocation = "{icon}"; '
            f'$sc.Description = "净值通 - Fund Stock Query"; '
            f'$sc.WorkingDirectory = "{self.install_dir}"; '
            f'$sc.Save()'
        )
        subprocess.run(["powershell", "-Command", ps_cmd], capture_output=True, timeout=10)

    def create_uninstaller(self):
        """Create uninstall.bat with auto-elevation"""
        uninstall_bat = os.path.join(self.install_dir, "Uninstall.bat")
        install_dir = self.install_dir

        bat_content = f"""@echo off\r
chcp 65001 >nul\r
:: Request admin privileges\r
net session >nul 2>&1\r
if errorlevel 1 (\r
    echo Requesting administrator privileges...\r
    powershell -Command "Start-Process '%~f0' -Verb RunAs"\r
    exit /b\r
)\r
echo Uninstalling...\r
taskkill /F /IM FundStockQuery.exe 2>nul\r
timeout /t 1 /nobreak >nul\r
del /q "{install_dir}\\FundStockQuery.exe" 2>nul\r
del /q "{install_dir}\\users.json" 2>nul\r
del /q "{install_dir}\\deleted_users.json" 2>nul\r
del /q "{install_dir}\\admin.db" 2>nul\r
del /q "{install_dir}\\admin.db-wal" 2>nul\r
del /q "{install_dir}\\admin.db-shm" 2>nul\r
del /q "{install_dir}\\server.log" 2>nul\r
del /q "{install_dir}\\Uninstall.bat" 2>nul\r
del /q "%USERPROFILE%\\Desktop\\净值通.lnk" 2>nul\r
rmdir /s /q "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Fund Stock Query" 2>nul\r
rmdir "{install_dir}" 2>nul\r
echo Uninstalled!\r
timeout /t 2 /nobreak >nul\r
"""

        with open(uninstall_bat, 'w', encoding='utf-8') as f:
            f.write(bat_content)

    def register_uninstall(self):
        """Register in Windows Add/Remove Programs"""
        try:
            import winreg
            # Use HKLM if admin, HKCU if not
            root_key = winreg.HKEY_LOCAL_MACHINE if is_admin() else winreg.HKEY_CURRENT_USER
            key_path = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\FundStockQuery"
            key = winreg.CreateKey(root_key, key_path)
            winreg.SetValueEx(key, "DisplayName", 0, winreg.REG_SZ, "净值通")
            winreg.SetValueEx(key, "DisplayVersion", 0, winreg.REG_SZ, "1.0.0")
            winreg.SetValueEx(key, "Publisher", 0, winreg.REG_SZ, "FundStockQuery")
            winreg.SetValueEx(key, "InstallLocation", 0, winreg.REG_SZ, self.install_dir)
            winreg.SetValueEx(key, "DisplayIcon", 0, winreg.REG_SZ,
                              os.path.join(self.install_dir, "FundStockQuery.exe"))
            winreg.SetValueEx(key, "UninstallString", 0, winreg.REG_SZ,
                              os.path.join(self.install_dir, "Uninstall.bat"))
            winreg.SetValueEx(key, "NoModify", 0, winreg.REG_DWORD, 1)
            winreg.SetValueEx(key, "NoRepair", 0, winreg.REG_DWORD, 1)
            winreg.CloseKey(key)
        except Exception:
            pass

    def show_finish(self):
        self.clear_frame()

        frame = tk.Frame(self.root, padx=40, pady=30)
        frame.pack(fill="both", expand=True)

        tk.Label(frame, text="", font=("Segoe UI", 8)).pack(pady=(10, 5))
        tk.Label(frame, text="\u2705", font=("Segoe UI", 30)).pack(pady=(0, 5))
        tk.Label(frame, text="Installation Complete!", font=("Segoe UI", 18, "bold"), fg="#1a237e").pack()
        tk.Label(frame, text="", font=("Segoe UI", 8)).pack(pady=(5, 10))

        tk.Label(frame,
                 text=f"Fund Stock Query has been installed to:\n{self.install_dir}",
                 font=("Segoe UI", 10), fg="#333", justify="left").pack()

        tk.Label(frame, text="", font=("Segoe UI", 8)).pack(pady=5)
        tk.Checkbutton(frame, text="Launch Fund Stock Query now", variable=self.launch_after,
                       font=("Segoe UI", 10)).pack(anchor="w", pady=5)

        btn_frame = tk.Frame(frame)
        btn_frame.pack(side="bottom", fill="x", pady=(20, 0))

        tk.Button(btn_frame, text="Finish", width=12, command=self.finish,
                  font=("Segoe UI", 10), bg="#1a237e", fg="white").pack(side="right")

    def finish(self):
        if self.launch_after.get():
            exe_path = os.path.join(self.install_dir, "FundStockQuery.exe")
            if os.path.exists(exe_path):
                subprocess.Popen([exe_path], cwd=self.install_dir)
        self.root.quit()


if __name__ == "__main__":
    import time

    root = tk.Tk()

    # Check if we were relaunched as admin with saved config
    app = InstallerApp(root)
    if is_admin():
        app.load_install_config()
        # If config was loaded, skip to install
        if app.install_dir and os.path.exists(os.path.join(os.environ.get("TEMP", ""), "fundquery_install.json")):
            pass  # Already loaded

    root.mainloop()
