attribute vec4 aVertexPos;
attribute vec2 aVertexTexCoord;
varying vec2 vVertexTexCoord;

void main() {
    gl_Position = aVertexPos;
    vVertexTexCoord = aVertexTexCoord;
}
