on run
  try
    set projectDir to do shell script "/bin/cat \"$HOME/.sijol-path\""
  on error
    display dialog "SIJ-OL no está instalado. Ejecute INSTALAR_SIJOL_MAC.command." buttons {"Aceptar"} default button 1 with icon stop
    return
  end try

  try
    do shell script "/usr/sbin/lsof -tiTCP:3000 -sTCP:LISTEN"
  on error
    set startCommand to "cd " & quoted form of projectDir & " && /bin/mkdir -p .data && /usr/bin/nohup /bin/zsh -lc " & quoted form of "npm start" & " >> .data/sijol.log 2>&1 </dev/null &"
    do shell script startCommand
    delay 4
  end try

  try
    do shell script "/usr/bin/curl -fsS --max-time 3 http://localhost:3000/api/health"
    open location "http://localhost:3000"
  on error
    display dialog "SIJ-OL no pudo iniciar. Revise el archivo .data/sijol.log dentro de la carpeta del sistema." buttons {"Aceptar"} default button 1 with icon stop
  end try
end run
