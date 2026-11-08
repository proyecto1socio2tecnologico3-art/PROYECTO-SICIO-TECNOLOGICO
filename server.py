import errno
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import webbrowser


ROOT = Path(__file__).resolve().parent
DATABASE_PATH = ROOT / "plataforma.db"
HOST = "127.0.0.1"
PORT = 8000
MAX_REQUEST_BYTES = 64 * 1024 * 1024
MAX_FIELDS_PER_CATEGORY = 20
MAX_GRADE_FIELDS = 5
MAX_SUBJECTS_PER_GRADE = 12
MAX_LEARNING_CONTENTS = 100
MAX_ARTICLE_WORDS = 5000
MAX_ARTICLES_PER_CONTENT = 3
MAX_QUIZZES_PER_CONTENT = 20
MAX_QUIZ_QUESTION_CHARS = 300
MAX_QUIZ_OPTION_CHARS = 80
MAX_LINKS_PER_CONTENT = 20
SUPERADMIN_USER = "admin_master"
INITIAL_SUPERADMIN_PASSWORD = os.environ.get("SUPERADMIN_PASSWORD", "K9#mX$8vP2!zQ")
INITIAL_PLATFORM_ACCESS_CODE = os.environ.get("PLATFORM_ACCESS_CODE")
PASSWORD_HASH_ITERATIONS = 310_000
SESSION_TTL_SECONDS = 12 * 60 * 60
SESSION_COOKIE = "pe_session"
CATEGORIES = ("avanzados", "generales", "grados")
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
}


class MySQLConnection:
    def __init__(self, connection):
        self.connection = connection

    def _run(self, query, values=None, many=False):
        import pymysql

        cursor = self.connection.cursor()
        if query.strip().upper() == "BEGIN IMMEDIATE":
            query = "START TRANSACTION"
        query = query.replace("?", "%s")
        try:
            if many:
                cursor.executemany(query, values)
            else:
                cursor.execute(query, values or ())
            return cursor
        except pymysql.MySQLError as error:
            raise sqlite3.DatabaseError(str(error)) from error

    def execute(self, query, values=None):
        return self._run(query, values)

    def executemany(self, query, values):
        return self._run(query, values, many=True)

    def commit(self):
        self.connection.commit()

    def rollback(self):
        self.connection.rollback()

    def close(self):
        self.connection.close()


class Database:
    def __init__(self, path):
        self.mysql = bool(os.environ.get("TIDB_HOST"))
        self.path = Path(path) if path is not None else DATABASE_PATH
        with self._connect() as connection:
            for statement in (
                """
                CREATE TABLE IF NOT EXISTS students (
                    username VARCHAR(191) PRIMARY KEY,
                    payload LONGTEXT NOT NULL
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS admins (
                    username VARCHAR(191) PRIMARY KEY,
                    payload LONGTEXT NOT NULL
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS admin_requests (
                    username VARCHAR(191) PRIMARY KEY,
                    payload LONGTEXT NOT NULL
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS learning_fields (
                    category VARCHAR(32) NOT NULL,
                    position INTEGER NOT NULL,
                    payload LONGTEXT NOT NULL,
                    PRIMARY KEY (category, position)
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS app_metadata (
                    `key` VARCHAR(191) PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS account_credentials (
                    role VARCHAR(32) NOT NULL,
                    username VARCHAR(191) NOT NULL,
                    salt VARCHAR(64) NOT NULL,
                    password_hash VARCHAR(128) NOT NULL,
                    PRIMARY KEY (role, username)
                )
                """,
            ):
                connection.execute(statement)
        if not self.mysql:
            self._remove_legacy_pdf_data()
        self._migrate_account_credentials()
        self._initialize_superadmin_password()
        self._initialize_platform_access_code()

    def _migrate_account_credentials(self):
        with self._connect() as connection:
            for table, role in (
                ("students", "student"),
                ("admins", "admin"),
                ("admin_requests", "pending_admin"),
            ):
                for row in connection.execute(f"SELECT username, payload FROM {table}").fetchall():
                    record = json.loads(row["payload"])
                    password = record.pop("pass", None)
                    if isinstance(password, str) and password:
                        self._set_password(connection, role, row["username"], password)
                        connection.execute(
                            f"UPDATE {table} SET payload = ? WHERE username = ?",
                            (self._serialize(record), row["username"]),
                        )
            connection.commit()

    def _set_password(self, connection, role, username, password):
        salt = secrets.token_hex(16)
        password_hash = self._hash_password(password, salt)
        if self.mysql:
            query = """
                INSERT INTO account_credentials (role, username, salt, password_hash)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE salt = VALUES(salt), password_hash = VALUES(password_hash)
            """
        else:
            query = """
                INSERT INTO account_credentials (role, username, salt, password_hash)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(role, username) DO UPDATE SET salt = excluded.salt,
                    password_hash = excluded.password_hash
            """
        connection.execute(query, (role, username, salt, password_hash))

    def verify_account_password(self, role, username, password):
        with self._connect() as connection:
            row = connection.execute(
                "SELECT salt, password_hash FROM account_credentials WHERE role = ? AND username = ?",
                (role, username),
            ).fetchone()
        return (
            row is not None
            and hmac.compare_digest(self._hash_password(password, row["salt"]), row["password_hash"])
        )

    def account_exists(self, role, username):
        table = "students" if role == "student" else "admins"
        with self._connect() as connection:
            return connection.execute(
                f"SELECT 1 FROM {table} WHERE username = ?", (username,)
            ).fetchone() is not None

    def create_student(self, name, grade, password):
        username = " ".join(name.strip().casefold().split())
        if len(username) > 191 or len(grade) > 80:
            return False
        record = {
            "nombre": name.strip(),
            "grado": grade,
            "progresoCompletado": {},
            "intentosQuizzes": {},
        }
        with self._connect() as connection:
            if connection.execute(
                "SELECT 1 FROM students WHERE username = ?", (username,)
            ).fetchone():
                return False
            connection.execute(
                "INSERT INTO students (username, payload) VALUES (?, ?)",
                (username, self._serialize(record)),
            )
            self._set_password(connection, "student", username, password)
            self._upsert_metadata(connection, (("initialized", "true"),))
            connection.commit()
        return True

    def create_admin_request(self, name, username, password, date):
        key = username.strip().casefold()
        if key == SUPERADMIN_USER or len(key) > 191 or len(name.strip()) > 191:
            return False
        record = {"nombre": name.strip(), "user": username.strip(), "fecha": date}
        with self._connect() as connection:
            if connection.execute(
                "SELECT 1 FROM admin_requests WHERE username = ?", (key,)
            ).fetchone() or connection.execute(
                "SELECT 1 FROM admins WHERE username = ?", (key,)
            ).fetchone():
                return False
            connection.execute(
                "INSERT INTO admin_requests (username, payload) VALUES (?, ?)",
                (key, self._serialize(record)),
            )
            self._set_password(connection, "pending_admin", key, password)
            self._upsert_metadata(connection, (("initialized", "true"),))
            connection.commit()
        return True

    def _remove_legacy_pdf_data(self):
        removed = False
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT category, position, payload FROM learning_fields"
            ).fetchall()
            for row in rows:
                field = json.loads(row["payload"])
                if self._strip_pdf_data(field):
                    removed = True
                    connection.execute(
                        """
                        UPDATE learning_fields SET payload = ?
                        WHERE category = ? AND position = ?
                        """,
                        (self._serialize(field), row["category"], row["position"]),
                    )
            if removed:
                connection.commit()
        if removed:
            with self._connect() as connection:
                connection.execute("VACUUM")

    @staticmethod
    def _strip_pdf_data(field):
        removed = False
        contents = [field]
        subjects = field.get("materias")
        if isinstance(subjects, list):
            contents.extend(subject for subject in subjects if isinstance(subject, dict))
        for content in contents:
            if "pdfs" in content:
                content.pop("pdfs")
                removed = True
        return removed

    @staticmethod
    def _hash_password(password, salt):
        return hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt), PASSWORD_HASH_ITERATIONS
        ).hex()

    def _initialize_superadmin_password(self):
        with self._connect() as connection:
            row = connection.execute(
                "SELECT value FROM app_metadata WHERE `key` = 'superadmin_password_salt'"
            ).fetchone()
            if row is not None:
                return

            salt = secrets.token_hex(16)
            password_hash = self._hash_password(INITIAL_SUPERADMIN_PASSWORD, salt)
            self._upsert_metadata(
                connection,
                (
                    ("superadmin_password_salt", salt),
                    ("superadmin_password_hash", password_hash),
                ),
            )

    def _initialize_platform_access_code(self):
        with self._connect() as connection:
            values = {
                row["key"]: row["value"]
                for row in connection.execute(
                    """
                    SELECT `key`, value FROM app_metadata
                    WHERE `key` IN ('platform_access_code_salt', 'platform_access_code_hash')
                    """
                )
            }
            if values:
                if len(values) != 2:
                    raise RuntimeError("La configuración del código general está incompleta.")
                return

            access_code = os.environ.get("PLATFORM_ACCESS_CODE")
            if not isinstance(access_code, str) or not 6 <= len(access_code) <= 128:
                raise RuntimeError(
                    "Configura PLATFORM_ACCESS_CODE con entre 6 y 128 caracteres."
                )
            salt = secrets.token_hex(16)
            self._upsert_metadata(
                connection,
                (
                    ("platform_access_code_salt", salt),
                    ("platform_access_code_hash", self._hash_password(access_code, salt)),
                ),
            )

    def _upsert_metadata(self, connection, values, commit=True):
        if self.mysql:
            query = """
                INSERT INTO app_metadata (`key`, value) VALUES (?, ?)
                ON DUPLICATE KEY UPDATE value = VALUES(value)
            """
        else:
            query = """
                INSERT INTO app_metadata (`key`, value) VALUES (?, ?)
                ON CONFLICT(`key`) DO UPDATE SET value = excluded.value
            """
        connection.executemany(query, values)
        if commit:
            connection.commit()

    def verify_superadmin_password(self, password):
        with self._connect() as connection:
            values = {
                row["key"]: row["value"]
                for row in connection.execute(
                    """
                    SELECT `key`, value FROM app_metadata
                    WHERE `key` IN ('superadmin_password_salt', 'superadmin_password_hash')
                    """
                )
            }
        salt = values.get("superadmin_password_salt")
        password_hash = values.get("superadmin_password_hash")
        return (
            salt is not None
            and password_hash is not None
            and hmac.compare_digest(self._hash_password(password, salt), password_hash)
        )

    def change_superadmin_password(self, current_password, new_password):
        if not self.verify_superadmin_password(current_password):
            return False

        salt = secrets.token_hex(16)
        password_hash = self._hash_password(new_password, salt)
        with self._connect() as connection:
            self._upsert_metadata(
                connection,
                (
                    ("superadmin_password_salt", salt),
                    ("superadmin_password_hash", password_hash),
                ),
            )
        return True

    def verify_platform_access_code(self, access_code):
        with self._connect() as connection:
            values = {
                row["key"]: row["value"]
                for row in connection.execute(
                    """
                    SELECT `key`, value FROM app_metadata
                    WHERE `key` IN ('platform_access_code_salt', 'platform_access_code_hash')
                    """
                )
            }
        salt = values.get("platform_access_code_salt")
        code_hash = values.get("platform_access_code_hash")
        return (
            isinstance(access_code, str)
            and salt is not None
            and code_hash is not None
            and hmac.compare_digest(self._hash_password(access_code, salt), code_hash)
        )

    def change_platform_access_code(self, current_password, new_code):
        if (
            not isinstance(new_code, str)
            or not 6 <= len(new_code) <= 128
            or not self.verify_superadmin_password(current_password)
        ):
            return False

        salt = secrets.token_hex(16)
        code_hash = self._hash_password(new_code, salt)
        with self._connect() as connection:
            self._upsert_metadata(
                connection,
                (
                    ("platform_access_code_salt", salt),
                    ("platform_access_code_hash", code_hash),
                ),
            )
        return True

    def change_admin_password(self, username, current_password, new_password):
        username_key = username.strip().casefold()
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT salt, password_hash FROM account_credentials
                WHERE role = 'admin' AND username = ?
                """,
                (username_key,),
            ).fetchone()
            if row is None or not hmac.compare_digest(
                self._hash_password(current_password, row["salt"]), row["password_hash"]
            ):
                return False
            self._set_password(connection, "admin", username_key, new_password)
            connection.commit()
        return True

    @contextmanager
    def _connect(self):
        if self.mysql:
            try:
                import pymysql
                import certifi
                from pymysql.cursors import DictCursor

                connection = MySQLConnection(pymysql.connect(
                    host=os.environ["TIDB_HOST"],
                    port=int(os.environ.get("TIDB_PORT", "4000")),
                    user=os.environ["TIDB_USER"],
                    password=os.environ["TIDB_PASSWORD"],
                    database=os.environ["TIDB_DATABASE"],
                    charset="utf8mb4",
                    cursorclass=DictCursor,
                    connect_timeout=10,
                    ssl={"ca": os.environ.get("TIDB_CA_PATH") or certifi.where()},
                    autocommit=False,
                ))
            except (KeyError, ValueError) as error:
                raise sqlite3.OperationalError("Faltan variables de conexión de TiDB.") from error
            except pymysql.MySQLError as error:
                raise sqlite3.OperationalError(f"No se pudo conectar con TiDB: {error}") from error
        else:
            connection = sqlite3.connect(self.path, timeout=10)
            connection.row_factory = sqlite3.Row
        try:
            yield connection
        finally:
            connection.close()

    @staticmethod
    def _serialize(value):
        return json.dumps(value, ensure_ascii=False, allow_nan=False)

    @staticmethod
    def _key(record, field, collection):
        value = record.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Cada elemento de {collection} debe tener {field}.")
        return value.strip().casefold()

    def _records(self, state, collection, key_field):
        records = state.get(collection)
        if not isinstance(records, list) or not all(isinstance(item, dict) for item in records):
            raise ValueError(f"El campo {collection} debe ser una lista de objetos.")
        values = []
        seen = set()
        for record in records:
            key = self._key(record, key_field, collection)
            if key in seen:
                raise ValueError(f"Hay valores duplicados en {collection}: {key}.")
            seen.add(key)
            safe_record = dict(record)
            safe_record.pop("pass", None)
            values.append((key, self._serialize(safe_record)))
        return values

    @staticmethod
    def _validate_content_limits(fields):
        if len(fields["avanzados"]) > MAX_FIELDS_PER_CATEGORY:
            raise ValueError(f"Se permiten como máximo {MAX_FIELDS_PER_CATEGORY} campos avanzados.")
        if len(fields["generales"]) > MAX_FIELDS_PER_CATEGORY:
            raise ValueError(f"Se permiten como máximo {MAX_FIELDS_PER_CATEGORY} campos generales.")
        if len(fields["grados"]) > MAX_GRADE_FIELDS:
            raise ValueError(f"Se permiten como máximo {MAX_GRADE_FIELDS} campos de grado.")

        learning_contents = len(fields["avanzados"]) + len(fields["generales"])
        for field_index, field in enumerate(fields["grados"], start=1):
            subjects = field.get("materias", [])
            if not isinstance(subjects, list) or not all(
                isinstance(subject, dict) for subject in subjects
            ):
                raise ValueError("Las materias de cada campo de grado deben ser una lista de objetos.")
            if len(subjects) > MAX_SUBJECTS_PER_GRADE:
                raise ValueError(
                    f"Cada campo de grado permite un máximo de {MAX_SUBJECTS_PER_GRADE} materias."
                )
            learning_contents += len(subjects)

        if learning_contents > MAX_LEARNING_CONTENTS:
            raise ValueError(
                f"La plataforma permite un máximo total de {MAX_LEARNING_CONTENTS} campos y materias."
            )

        for category in ("avanzados", "generales", "grados"):
            for field in fields[category]:
                subjects = field.get("materias", [])
                if not isinstance(subjects, list) or not all(
                    isinstance(subject, dict) for subject in subjects
                ):
                    raise ValueError("Las materias de cada campo deben ser una lista de objetos.")
                contents = [field, *subjects]
                for content in contents:
                    quizzes = content.get("cuestionarios", [])
                    if not isinstance(quizzes, list):
                        raise ValueError("Los cuestionarios de cada campo o materia deben ser una lista.")
                    if len(quizzes) > MAX_QUIZZES_PER_CONTENT:
                        raise ValueError(
                            f"Cada campo o materia permite un máximo de {MAX_QUIZZES_PER_CONTENT} cuestionarios."
                        )
                    for quiz in quizzes:
                        if not isinstance(quiz, dict):
                            raise ValueError("Cada cuestionario debe ser un objeto.")
                        question = quiz.get("pregunta", "")
                        options = [quiz.get(f"opcion{index}", "") for index in range(1, 4)]
                        if not isinstance(question, str) or len(question) > MAX_QUIZ_QUESTION_CHARS:
                            raise ValueError(
                                f"Cada pregunta permite un máximo de {MAX_QUIZ_QUESTION_CHARS} caracteres."
                            )
                        if any(not isinstance(option, str) for option in options):
                            raise ValueError("Las opciones del cuestionario deben ser texto.")
                        if any(len(option) > MAX_QUIZ_OPTION_CHARS for option in options):
                            raise ValueError(
                                f"Cada opción permite un máximo de {MAX_QUIZ_OPTION_CHARS} caracteres."
                            )

                    links = content.get("sitiosWeb", [])
                    if not isinstance(links, list):
                        raise ValueError("Los enlaces de cada campo o materia deben ser una lista.")
                    if len(links) > MAX_LINKS_PER_CONTENT:
                        raise ValueError(
                            f"Cada campo o materia permite un máximo de {MAX_LINKS_PER_CONTENT} enlaces."
                        )

                    articles = content.get("articulos", [])
                    if not isinstance(articles, list):
                        raise ValueError("Los artículos de cada campo o materia deben ser una lista.")
                    if len(articles) > MAX_ARTICLES_PER_CONTENT:
                        article_label = "artículo" if MAX_ARTICLES_PER_CONTENT == 1 else "artículos"
                        raise ValueError(
                            f"Cada campo o materia permite un máximo de {MAX_ARTICLES_PER_CONTENT} {article_label}."
                        )
                    for article in articles:
                        if not isinstance(article, dict) or not isinstance(
                            article.get("textoContinuo", ""), str
                        ):
                            raise ValueError("Cada artículo debe tener texto válido.")
                        if len(article["textoContinuo"].split()) > MAX_ARTICLE_WORDS:
                            raise ValueError(
                                f"Cada artículo permite un máximo de {MAX_ARTICLE_WORDS} palabras."
                            )

    def save_state(self, state, role="superadmin", username=None):
        if not isinstance(state, dict):
            raise ValueError("El estado debe ser un objeto JSON.")

        if role == "student":
            supplied_users = state.get("users")
            if not isinstance(supplied_users, list):
                raise ValueError("La lista de estudiantes no es válida.")
            current = self.load_state()
            account_key = " ".join(username.casefold().split())
            supplied = next(
                (record for record in supplied_users
                 if isinstance(record, dict)
                 and isinstance(record.get("nombre"), str)
                 and " ".join(record["nombre"].casefold().split()) == account_key),
                None,
            )
            if supplied is None:
                raise ValueError("No se encontró la cuenta de estudiante autenticada.")
            account = next(
                record for record in current["users"]
                if " ".join(record.get("nombre", "").casefold().split()) == account_key
            )
            for property_name in ("progresoCompletado", "intentosQuizzes"):
                value = supplied.get(property_name, {})
                if not isinstance(value, dict):
                    raise ValueError("El progreso del estudiante no es válido.")
                account[property_name] = value
            return self.save_state(current)

        if role == "admin":
            current = self.load_state()
            if current is None or not isinstance(state.get("fields"), dict):
                raise ValueError("El estado de campos no es válido.")
            admin = next(
                (record for record in current["admins"]
                 if record.get("user", "").casefold() == username),
                None,
            )
            if admin is None:
                raise ValueError("La cuenta administrativa ya no está activa.")
            assignments = admin.get("camposAsignados", [admin.get("campoAsignado")])
            assignments = [item for item in assignments if isinstance(item, dict)]
            incoming_fields = state.get("fields", {})
            for category in CATEGORIES:
                if not isinstance(incoming_fields.get(category), list):
                    continue
                for field_index, existing in enumerate(current["fields"][category]):
                    if field_index >= len(incoming_fields[category]):
                        continue
                    incoming = incoming_fields[category][field_index]
                    if not isinstance(incoming, dict) or incoming.get("id") != existing.get("id"):
                        continue
                    owned = any(
                        item.get("cat") == category
                        and item.get("fieldId") == existing.get("id")
                        and not item.get("subjectId")
                        for item in assignments
                    )
                    if owned:
                        assigned_to = existing.get("adminAsignado")
                        existing.clear()
                        existing.update(incoming)
                        existing["adminAsignado"] = assigned_to
                        continue
                    for subject_index, subject in enumerate(existing.get("materias", [])):
                        if subject_index >= len(incoming.get("materias", [])):
                            continue
                        new_subject = incoming["materias"][subject_index]
                        if not isinstance(new_subject, dict) or new_subject.get("id") != subject.get("id"):
                            continue
                        if any(
                            item.get("cat") == category
                            and item.get("fieldId") == existing.get("id")
                            and item.get("subjectId") == subject.get("id")
                            for item in assignments
                        ):
                            assigned_to = subject.get("adminAsignado")
                            subject.clear()
                            subject.update(new_subject)
                            subject["adminAsignado"] = assigned_to
            return self.save_state(current)

        students = self._records(state, "users", "nombre")
        admins = self._records(state, "admins", "user")
        requests = self._records(state, "requests", "user")
        fields = state.get("fields")
        if not isinstance(fields, dict) or any(
            not isinstance(fields.get(category), list)
            or not all(isinstance(item, dict) for item in fields[category])
            for category in CATEGORIES
        ):
            raise ValueError("Los campos educativos deben incluir listas para cada categoría.")
        for records in fields.values():
            for record in records:
                self._strip_pdf_data(record)
        self._validate_content_limits(fields)
        serialized_fields = [
            (category, position, self._serialize(record))
            for category in CATEGORIES
            for position, record in enumerate(fields[category])
        ]

        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                for records, role, key_field in (
                    (state["users"], "student", "nombre"),
                    (state["admins"], "admin", "user"),
                    (state["requests"], "pending_admin", "user"),
                ):
                    for record in records:
                        password = record.get("pass")
                        if isinstance(password, str) and password:
                            self._set_password(
                                connection, role, self._key(record, key_field, role), password
                            )
                for admin in state["admins"]:
                    username = self._key(admin, "user", "admins")
                    if admin.get("pass"):
                        continue
                    pending = connection.execute(
                        """
                        SELECT salt, password_hash FROM account_credentials
                        WHERE role = 'pending_admin' AND username = ?
                        """,
                        (username,),
                    ).fetchone()
                    if pending:
                        connection.execute(
                            "DELETE FROM account_credentials WHERE role = 'admin' AND username = ?",
                            (username,),
                        )
                        connection.execute(
                            """
                            INSERT INTO account_credentials (role, username, salt, password_hash)
                            VALUES ('admin', ?, ?, ?)
                            """,
                            (username, pending["salt"], pending["password_hash"]),
                        )
                        connection.execute(
                            "DELETE FROM account_credentials WHERE role = 'pending_admin' AND username = ?",
                            (username,),
                        )
                for table in ("students", "admins", "admin_requests", "learning_fields"):
                    connection.execute(f"DELETE FROM {table}")
                connection.executemany(
                    "INSERT INTO students (username, payload) VALUES (?, ?)", students
                )
                connection.executemany(
                    "INSERT INTO admins (username, payload) VALUES (?, ?)", admins
                )
                connection.executemany(
                    "INSERT INTO admin_requests (username, payload) VALUES (?, ?)", requests
                )
                connection.executemany(
                    """
                    INSERT INTO learning_fields (category, position, payload)
                    VALUES (?, ?, ?)
                    """,
                    serialized_fields,
                )
                self._upsert_metadata(
                    connection, (("initialized", "true"),), commit=False
                )
                for role, records, key_field in (
                    ("student", state["users"], "nombre"),
                    ("admin", state["admins"], "user"),
                    ("pending_admin", state["requests"], "user"),
                ):
                    valid_names = {
                        self._key(record, key_field, role) for record in records
                    }
                    for row in connection.execute(
                        "SELECT username FROM account_credentials WHERE role = ?", (role,)
                    ).fetchall():
                        if row["username"] not in valid_names:
                            connection.execute(
                                "DELETE FROM account_credentials WHERE role = ? AND username = ?",
                                (role, row["username"]),
                            )
                connection.commit()
            except sqlite3.Error:
                connection.rollback()
                raise

    def load_state(self, role=None, username=None):
        with self._connect() as connection:
            initialized = connection.execute(
                "SELECT value FROM app_metadata WHERE `key` = 'initialized'"
            ).fetchone()
            if initialized is None:
                return None

            state = {
                "users": [],
                "admins": [],
                "requests": [],
                "fields": {category: [] for category in CATEGORIES},
            }
            for row in connection.execute("SELECT payload FROM students ORDER BY username"):
                state["users"].append(json.loads(row["payload"]))
            for row in connection.execute("SELECT payload FROM admins ORDER BY username"):
                state["admins"].append(json.loads(row["payload"]))
            for row in connection.execute("SELECT payload FROM admin_requests ORDER BY username"):
                state["requests"].append(json.loads(row["payload"]))
            for row in connection.execute(
                "SELECT category, payload FROM learning_fields ORDER BY category, position"
            ):
                state["fields"][row["category"]].append(json.loads(row["payload"]))
        if role == "student":
            key = " ".join(username.casefold().split())
            state["users"] = [
                user for user in state["users"]
                if " ".join(user.get("nombre", "").casefold().split()) == key
            ]
            state["admins"] = []
            state["requests"] = []
        elif role == "admin":
            admin = next(
                (record for record in state["admins"] if record.get("user", "").casefold() == username),
                None,
            )
            assigned = set()
            if admin:
                for assignment in admin.get("camposAsignados", [admin.get("campoAsignado")]):
                    if assignment:
                        assigned.add((
                            assignment.get("cat"),
                            assignment.get("fieldId"),
                            assignment.get("subjectId"),
                        ))
            allowed = set()
            for category in CATEGORIES:
                for field_index, field in enumerate(state["fields"][category]):
                    field_id = field.get("id")
                    if field.get("adminAsignado") == username:
                        allowed.add(f"{category}_{field_index}_")
                    for subject_index, subject in enumerate(field.get("materias", [])):
                        if subject.get("adminAsignado") == username:
                            allowed.add(f"{category}_{field_index}_{subject_index}_")
                    if (category, field_id, None) in assigned:
                        continue
                    subjects = field.get("materias", [])
                    field["materias"] = [
                        subject if (category, field_id, subject.get("id")) in assigned else {
                            "id": subject.get("id"),
                            "titulo": subject.get("titulo", ""),
                            "resumen": subject.get("resumen", ""),
                            "adminAsignado": subject.get("adminAsignado"),
                            "cuestionarios": [],
                            "articulos": [],
                            "sitiosWeb": [],
                            "contenido": "",
                        }
                        for subject in subjects
                    ]
                    field["cuestionarios"] = []
                    field["articulos"] = []
                    field["sitiosWeb"] = []
                    field["contenido"] = ""
            state["admins"] = [admin] if admin else []
            state["requests"] = []
            for student in state["users"]:
                student["progresoCompletado"] = {
                    key: value for key, value in student.get("progresoCompletado", {}).items()
                    if any(key.startswith(prefix) for prefix in allowed)
                }
                student["intentosQuizzes"] = {
                    key: value for key, value in student.get("intentosQuizzes", {}).items()
                    if any(key.startswith(prefix) for prefix in allowed)
                }
        return state

    def load_admin_updates(self, role="superadmin", username=None):
        state = self.load_state(role, username)
        if state is None:
            return None
        return {"users": state["users"], "requests": state["requests"]}


class PlatformHandler(BaseHTTPRequestHandler):
    database = None
    sessions = {}
    sessions_lock = threading.Lock()
    access_tokens = {}
    access_tokens_lock = threading.Lock()
    login_attempts = {}
    login_attempts_lock = threading.Lock()
    session_cookie_to_set = None

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        if self.session_cookie_to_set:
            self.send_header("Set-Cookie", self.session_cookie_to_set)
            self.session_cookie_to_set = None
        self.end_headers()
        self.wfile.write(body)

    def _require_access(self):
        from http.cookies import SimpleCookie

        cookie = SimpleCookie()
        cookie.load(self.headers.get("Cookie", ""))
        morsel = cookie.get(SESSION_COOKIE)
        token = morsel.value if morsel else ""
        with self.sessions_lock:
            session = self.sessions.get(token)
            if session and session["expires"] <= time.time():
                del self.sessions[token]
                session = None
        if session and session["role"] != "superadmin":
            try:
                active = self.database.account_exists(session["role"], session["username"])
            except sqlite3.Error:
                self._send_json(500, {"error": "No se pudo validar la sesión."})
                return None
            if not active:
                with self.sessions_lock:
                    self.sessions.pop(token, None)
                session = None
        if session is None:
            self._clear_session()
            self._send_json(401, {"error": "Inicia sesión para continuar."})
        return session

    def _require_platform_access(self):
        token = self.headers.get("X-Platform-Access", "")
        with self.access_tokens_lock:
            expires = self.access_tokens.get(token)
            if expires is not None and expires <= time.time():
                del self.access_tokens[token]
                expires = None
        if not expires:
            self._send_json(401, {"error": "Ingresa el código general para continuar."})
            return False
        return True

    def _create_session(self, role, username):
        token = secrets.token_urlsafe(32)
        with self.sessions_lock:
            self.sessions[token] = {
                "role": role,
                "username": username,
                "expires": time.time() + SESSION_TTL_SECONDS,
            }
        secure = "; Secure" if os.environ.get("RENDER") or os.environ.get("DEPLOYMENT_ENV") == "production" else ""
        self.session_cookie_to_set = (
            f"{SESSION_COOKIE}={token}; Path=/; Max-Age={SESSION_TTL_SECONDS}; "
            f"HttpOnly; SameSite=Strict{secure}"
        )

    def _clear_session(self):
        from http.cookies import SimpleCookie

        cookie = SimpleCookie()
        cookie.load(self.headers.get("Cookie", ""))
        morsel = cookie.get(SESSION_COOKIE)
        if morsel:
            with self.sessions_lock:
                self.sessions.pop(morsel.value, None)
        secure = "; Secure" if os.environ.get("RENDER") or os.environ.get("DEPLOYMENT_ENV") == "production" else ""
        self.session_cookie_to_set = f"{SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict{secure}"

    def _revoke_other_sessions(self, username):
        from http.cookies import SimpleCookie

        cookie = SimpleCookie()
        cookie.load(self.headers.get("Cookie", ""))
        current = cookie.get(SESSION_COOKIE)
        current_token = current.value if current else None
        with self.sessions_lock:
            for token, session in list(self.sessions.items()):
                if session["username"] == username and token != current_token:
                    del self.sessions[token]

    def _require_role(self, *roles):
        session = self._require_access()
        if session is None:
            return None
        if session["role"] not in roles:
            self._send_json(403, {"error": "No tienes permiso para esta acción."})
            return None
        return session

    def _same_origin(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True
        expected_scheme = "https" if os.environ.get("RENDER") or os.environ.get("DEPLOYMENT_ENV") == "production" else "http"
        return origin == f"{expected_scheme}://{self.headers.get('Host', '')}"

    def _login_rate_limited(self):
        now = time.time()
        address = self.client_address[0]
        with self.login_attempts_lock:
            attempts = [
                attempt for attempt in self.login_attempts.get(address, [])
                if now - attempt < 900
            ]
            self.login_attempts[address] = attempts
            return len(attempts) >= 8

    def _record_login_failure(self):
        with self.login_attempts_lock:
            self.login_attempts.setdefault(self.client_address[0], []).append(time.time())

    def _clear_login_failures(self):
        with self.login_attempts_lock:
            self.login_attempts.pop(self.client_address[0], None)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/healthz":
            self._send_json(200, {"ok": True})
            return
        if path == "/api/state":
            if not self._require_platform_access():
                return
            session = self._require_access() if self.headers.get("Cookie") else None
            if self.headers.get("Cookie") and session is None:
                return
            state = self.database.load_state(session["role"], session["username"]) if session else None
            if state is None:
                state = {
                    "users": [],
                    "admins": [],
                    "requests": [],
                    "fields": {category: [] for category in CATEGORIES},
                }
            self._send_json(
                200,
                {
                    "state": state,
                    "session": (
                        {"role": session["role"], "username": session["username"]}
                        if session else None
                    ),
                },
            )
            return
        if path == "/api/admin-updates":
            if not self._require_platform_access():
                return
            session = self._require_role("superadmin", "admin")
            if session is None:
                return
            self._send_json(
                200,
                {"updates": self.database.load_admin_updates(
                    session["role"], session["username"]
                )},
            )
            return
        static_file = STATIC_FILES.get(path)
        if static_file is None:
            self._send_json(404, {"error": "Recurso no encontrado."})
            return
        filename, content_type = static_file
        body = (ROOT / filename).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = urlsplit(self.path).path
        if path == "/api/access-code/verify":
            allowed_paths = {path}
        else:
            allowed_paths = {
                "/api/admin-login",
                "/api/student/login",
                "/api/student/register",
                "/api/admin-requests",
                "/api/admin-password",
                "/api/logout",
                "/api/platform-access-code",
            }
        if path not in allowed_paths:
            self._send_json(404, {"error": "Ruta no encontrada."})
            return
        if not self._same_origin():
            self._send_json(403, {"error": "Origen de solicitud no permitido."})
            return
        if path in ("/api/access-code/verify", "/api/admin-login", "/api/student/login") and self._login_rate_limited():
            self._send_json(429, {"error": "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo."})
            return
        if path != "/api/access-code/verify" and not self._require_platform_access():
            return
        if path == "/api/platform-access-code" and self._login_rate_limited():
            self._send_json(429, {"error": "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo."})
            return
        session = None
        if path in ("/api/admin-password", "/api/logout"):
            session = self._require_access()
            if session is None:
                return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 8192:
                self._send_json(413, {"error": "El tamaño de la solicitud no es válido."})
                return
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("La solicitud debe ser un objeto JSON.")
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            self._send_json(400, {"error": str(error)})
            return

        if path == "/api/access-code/verify":
            access_code = payload.get("code")
            if not isinstance(access_code, str) or not access_code or len(access_code) > 128:
                self._send_json(400, {"error": "Ingresa un código general válido."})
                return
            try:
                valid = self.database.verify_platform_access_code(access_code)
            except sqlite3.Error:
                self._send_json(500, {"error": "No se pudo verificar el código general."})
                return
            if not valid:
                self._record_login_failure()
                self._send_json(401, {"error": "El código general no es correcto."})
                return
            self._clear_login_failures()
            token = secrets.token_urlsafe(32)
            with self.access_tokens_lock:
                self.access_tokens[token] = time.time() + SESSION_TTL_SECONDS
            self._send_json(200, {"token": token})
            return

        if path == "/api/platform-access-code":
            username = payload.get("username")
            current_password = payload.get("password")
            new_code = payload.get("newCode")
            if (
                username != SUPERADMIN_USER
                or not isinstance(current_password, str)
                or not isinstance(new_code, str)
            ):
                self._send_json(400, {"error": "Completa los datos del código general."})
                return
            if not 6 <= len(new_code) <= 128:
                self._send_json(400, {"error": "El código nuevo debe tener entre 6 y 128 caracteres."})
                return
            try:
                changed = self.database.change_platform_access_code(current_password, new_code)
            except sqlite3.Error:
                self._send_json(500, {"error": "No se pudo guardar el código general."})
                return
            if not changed:
                self._record_login_failure()
                self._send_json(401, {"error": "La contraseña del Administrador Principal no es correcta."})
                return
            self._clear_login_failures()
            with self.access_tokens_lock:
                self.access_tokens.clear()
            self._send_json(200, {"changed": True})
            return

        if path == "/api/admin-login":
            username_value = payload.get("username")
            password = payload.get("password")
            if (
                not isinstance(username_value, str)
                or not isinstance(password, str)
                or not password
                or len(password) > 128
            ):
                self._send_json(400, {"error": "Ingresa un usuario y una contraseña válidos."})
                return
            username = username_value.strip().casefold()
            try:
                if username == SUPERADMIN_USER:
                    authenticated = self.database.verify_superadmin_password(password)
                    role = "superadmin"
                else:
                    authenticated = self.database.verify_account_password("admin", username, password)
                    role = "admin"
            except sqlite3.Error:
                self._send_json(500, {"error": "No se pudo verificar el acceso administrativo."})
                return
            if not authenticated:
                self._record_login_failure()
                self._send_json(401, {"error": "Credenciales administrativas incorrectas."})
                return
            self._clear_login_failures()
            self._create_session(role, username)
            self._send_json(200, {"authenticated": True, "role": role, "username": username})
            return

        if path in ("/api/student/login", "/api/student/register"):
            name = payload.get("name")
            password = payload.get("password")
            if (
                not isinstance(name, str) or not name.strip()
                or not isinstance(password, str) or len(password) > 128
            ):
                self._send_json(400, {"error": "Ingresa tu nombre y contraseña."})
                return
            username = " ".join(name.strip().casefold().split())
            try:
                if path == "/api/student/register":
                    grade = payload.get("grade")
                    if not isinstance(grade, str) or not grade or len(password) < 8 or len(password) > 128:
                        self._send_json(400, {"error": "La contraseña debe tener entre 8 y 128 caracteres."})
                        return
                    if not self.database.create_student(name, grade, password):
                        self._send_json(409, {"error": "Ya existe una cuenta con ese nombre."})
                        return
                elif not self.database.verify_account_password("student", username, password):
                    self._record_login_failure()
                    self._send_json(401, {"error": "Nombre o contraseña incorrectos."})
                    return
            except sqlite3.Error:
                self._send_json(500, {"error": "No se pudo procesar la cuenta."})
                return
            self._create_session("student", username)
            self._clear_login_failures()
            self._send_json(200, {"authenticated": True, "role": "student", "username": username})
            return

        if path == "/api/admin-requests":
            name = payload.get("name")
            username = payload.get("username")
            password = payload.get("password")
            if not all(isinstance(value, str) and value.strip() for value in (name, username, password)):
                self._send_json(400, {"error": "Completa todos los datos de solicitud."})
                return
            if not 8 <= len(password) <= 128:
                self._send_json(400, {"error": "La contraseña debe tener entre 8 y 128 caracteres."})
                return
            try:
                created = self.database.create_admin_request(
                    name, username, password, time.strftime("%d/%m/%Y")
                )
            except sqlite3.Error:
                self._send_json(500, {"error": "No se pudo enviar la solicitud."})
                return
            if not created:
                self._send_json(409, {"error": "Ya existe una solicitud o cuenta con ese usuario."})
                return
            self._send_json(201, {"submitted": True})
            return

        if path == "/api/logout":
            self._clear_session()
            self._send_json(200, {"loggedOut": True})
            return

        username = payload.get("username")
        current_password = payload.get("currentPassword")
        new_password = payload.get("newPassword")
        if not all(isinstance(value, str) for value in (username, current_password, new_password)):
            self._send_json(400, {"error": "Completa los datos de cambio de contraseña."})
            return
        if username.casefold() != session["username"]:
            self._send_json(403, {"error": "No puedes cambiar la contraseña de otra cuenta."})
            return
        if len(new_password) < 8 or len(new_password) > 128 or new_password == current_password:
            self._send_json(400, {"error": "La nueva contraseña debe ser distinta y tener entre 8 y 128 caracteres."})
            return
        try:
            if session["role"] == "superadmin":
                changed = self.database.change_superadmin_password(current_password, new_password)
            else:
                changed = self.database.change_admin_password(username, current_password, new_password)
        except sqlite3.Error:
            self._send_json(500, {"error": "No se pudo guardar la nueva contraseña."})
            return
        if not changed:
            self._send_json(401, {"error": "La contraseña actual no es correcta."})
            return
        self._revoke_other_sessions(username.casefold())
        self._send_json(200, {"changed": True})

    def do_PUT(self):
        if urlsplit(self.path).path != "/api/state":
            self._send_json(404, {"error": "Ruta no encontrada."})
            return
        if not self._require_platform_access():
            return
        session = self._require_access()
        if session is None:
            return
        if not self._same_origin():
            self._send_json(403, {"error": "Origen de solicitud no permitido."})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
                self._send_json(413, {"error": "El tamaño de la solicitud no es válido."})
                return
            state = json.loads(self.rfile.read(content_length).decode("utf-8"))
            self.database.save_state(state, session["role"], session["username"])
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            self._send_json(400, {"error": str(error)})
            return
        except sqlite3.Error:
            self._send_json(500, {"error": "No se pudo guardar la información en SQLite."})
            return
        self._send_json(200, {"saved": True})

    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}")


def create_platform_server(handler, port=None):
    production = bool(
        os.environ.get("RENDER") or os.environ.get("DEPLOYMENT_ENV") == "production"
    )
    host = "0.0.0.0" if production else HOST
    requested_port = int(os.environ.get("PORT", port if port is not None else PORT))
    try:
        return ThreadingHTTPServer((host, requested_port), handler)
    except OSError as error:
        if error.errno != errno.EADDRINUSE or production:
            raise
        return ThreadingHTTPServer((host, 0), handler)


def main():
    production = bool(
        os.environ.get("RENDER") or os.environ.get("DEPLOYMENT_ENV") == "production"
    )
    if production:
        required = (
            "TIDB_HOST", "TIDB_USER", "TIDB_PASSWORD", "TIDB_DATABASE",
            "PLATFORM_ACCESS_CODE",
        )
        missing = [key for key in required if not os.environ.get(key)]
        if missing:
            raise RuntimeError(f"Faltan variables de entorno requeridas: {', '.join(missing)}")
        if not os.environ.get("SUPERADMIN_PASSWORD"):
            raise RuntimeError("Configura SUPERADMIN_PASSWORD en Render.")
        if not 6 <= len(os.environ["PLATFORM_ACCESS_CODE"]) <= 128:
            raise RuntimeError("PLATFORM_ACCESS_CODE debe tener entre 6 y 128 caracteres.")
    elif not os.environ.get("PLATFORM_ACCESS_CODE"):
        import getpass

        os.environ["PLATFORM_ACCESS_CODE"] = getpass.getpass(
            "Ingresa el código general de la plataforma (6 a 128 caracteres): "
        )
        if not 6 <= len(os.environ["PLATFORM_ACCESS_CODE"]) <= 128:
            raise RuntimeError("El código general debe tener entre 6 y 128 caracteres.")
    database = Database(DATABASE_PATH)
    handler = type("BoundPlatformHandler", (PlatformHandler,), {"database": database})
    server = create_platform_server(handler)
    if not production and server.server_port != PORT:
        print(f"El puerto {PORT} está ocupado; se usará el puerto {server.server_port}.")

    url = f"http://127.0.0.1:{server.server_port}"
    print(f"Plataforma disponible en {url if not production else '0.0.0.0:' + str(server.server_port)}", flush=True)
    print(f"Base de datos: {'TiDB' if database.mysql else 'SQLite: ' + str(DATABASE_PATH)}")
    if not production:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
