"""Private immutable no-follow descriptor storage; never ZIP parsing here."""
import hashlib
import json
import os
import pathlib
import stat
import uuid


def private_directory(path):
    path = pathlib.Path(path)
    if not path.is_absolute():
        raise ValueError('absolute-private-root-required')
    for part in [*reversed(path.parents), path]:
        if part.is_symlink():
            raise ValueError('storage-symlink')
    s = path.lstat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != os.getuid() or stat.S_IMODE(s.st_mode) != 0o700:
        raise ValueError('private-owned-directory-required')
    return path


def bounded_file(path, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= maximum or before.st_uid != os.getuid():
            raise ValueError('nonregular-or-oversize-or-owner')
        raw = bytearray()
        while len(raw) <= maximum:
            block = os.read(fd, min(65536, maximum + 1 - len(raw)))
            if not block:
                break
            raw.extend(block)
        after, named = os.fstat(fd), os.lstat(path)
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if len(raw) != before.st_size or identity(before) != identity(after) or identity(before) != identity(named):
            raise ValueError('file-changed')
        return bytes(raw)
    finally:
        os.close(fd)


def completed_file(directory, guid, expected):
    path = private_directory(directory) / guid
    if (path.parent / (guid + '.crdownload')).exists() or (path.parent / (guid + '.crdownload')).is_symlink():
        raise ValueError('partial-download-refused')
    raw = bounded_file(path, 2_000_000)
    if len(raw) != expected:
        raise ValueError('download-event-file-size-conflict')
    return raw


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def publish(path, raw):
    private_directory(path.parent)
    temporary = path.parent / ('.write-' + uuid.uuid4().hex)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            if bounded_file(path, len(raw)) != raw:
                raise ValueError('immutable-original-conflict')
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        temporary.unlink()


def retain_capture(directory, parts):
    directory = private_directory(directory)
    if set(parts) != {'original.zip', 'original-receipt.json', 'acquisition.json'}:
        raise ValueError('capture-fixed-names-required')
    for name, raw in parts.items():
        publish(directory / name, raw)
    # Persist the capture directory entry before its completion marker. Replay
    # repeats this barrier because an earlier parent fsync may have failed.
    sync_directory(directory.parent)
    manifest = {'schemaVersion': 'pa-browser-capture-1', 'files': {name: {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)} for name, raw in parts.items()}}
    publish(directory / 'capture-complete.json', (json.dumps(manifest, sort_keys=True, separators=(',', ':')) + '\n').encode())
    return manifest
