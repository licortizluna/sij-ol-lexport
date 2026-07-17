on run
  try
    set projectDir to do shell script "/bin/cat \"$HOME/.sijol-path\""
    do shell script "/usr/bin/pkill -f " & quoted form of (projectDir & "/backend/server.js")
    display notification "Servidor detenido correctamente" with title "SIJ-OL"
  on error
    display notification "SIJ-OL ya estaba detenido" with title "SIJ-OL"
  end try
end run
