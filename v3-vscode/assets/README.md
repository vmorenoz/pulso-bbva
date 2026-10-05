# Identidad visual de Pulso

`pulso.svg` es el original vectorial editable: geometría SVG real, fondo transparente, sin imágenes incrustadas, fuentes ni recursos externos. Conserva el robot, la antena y las ondas laterales del diseño aprobado.

- `pulso-128.png`: exportación de 128 × 128 px.
- `pulso-256.png`: icono de la extensión y cabecera de su README, 256 × 256 px.
- `pulso-512.png`: exportación de alta resolución, 512 × 512 px.

Los PNG se exportan directamente del SVG, con transparencia y sin cambiar su proporción. Para regenerarlos con Inkscape desde `v3-vscode`:

```sh
for size in 128 256 512; do
  inkscape assets/pulso.svg --export-type=png \
    --export-width="$size" --export-height="$size" \
    --export-filename="assets/pulso-$size.png"
done
```

El [manifiesto de VS Code](https://code.visualstudio.com/api/references/extension-manifest) recomienda al menos 128 × 128 px (256 × 256 para Retina). Las [reglas de publicación](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) no admiten SVG como icono del manifiesto ni como imagen del README de Marketplace. Por ello, el manifiesto y el README de la extensión usan PNG; el README general del repositorio utiliza el SVG.

Paleta: azul marino `#072D58`, azul `#0072CE`, turquesa `#2DCCD3` y blanco `#FFFFFF`.
