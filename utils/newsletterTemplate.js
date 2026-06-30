function newsletterTemplate(newsletter) {

    return `
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width, initial-scale=1.0">

<title>${newsletter.subject}</title>

</head>

<body
style="
margin:0;
padding:0;
background:#eef2f7;
font-family:Arial,Helvetica,sans-serif;
">

<table
width="100%"
cellpadding="0"
cellspacing="0"
style="padding:40px 0;">

<tr>

<td align="center">

<table
width="650"
cellpadding="0"
cellspacing="0"
style="
background:#fff;
border-radius:14px;
overflow:hidden;
">

<!-- HEADER -->

<tr>

<td
align="center"
style="
background:#0B63CE;
padding:35px;
">

<img
src="https://acad.jkthub.com/images/JKT%20logo%20bg.png"
width="90"
style="display:block">

<h1
style="
color:#fff;
margin:15px 0 5px;
font-size:28px;
">

JKT Hub

</h1>

<p
style="
margin:0;
color:#dbe9ff;
font-size:15px;
">

Empowering Future Innovators Through Technology

</p>

</td>

</tr>

${
newsletter.image_url
?
`

<tr>

<td>

<img
src="${newsletter.image_url}"
style="
display:block;
width:100%;
height:auto;
max-height:280px;
object-fit:cover;
">

</td>

</tr>

`
:
""
}

<tr>

<td style="padding:45px;">

<h2
style="
margin-top:0;
font-size:30px;
color:#222;
">

${newsletter.subject}

</h2>

${
newsletter.preview_text
?
`

<p
style="
color:#888;
font-size:17px;
margin-bottom:30px;
">

${newsletter.preview_text}

</p>

`
:
""
}

<div
style="
font-size:16px;
line-height:1.9;
color:#444;
">

${newsletter.message}

</div>

</td>

</tr>

<tr>

<td
style="
background:#f7f7f7;
padding:35px;
text-align:center;
">

<p
style="
margin:0;
font-size:18px;
font-weight:bold;
">

JKT Hub

</p>

<p
style="
color:#777;
margin:10px 0;
">

Website:
<a
href="https://jkthub.com"
style="color:#0B63CE;">
www.jkthub.com
</a>

</p>

<p
style="
font-size:13px;
color:#999;
line-height:1.7;
">

You are receiving this email because you are registered on JKT Hub.

</p>

</td>

</tr>

</table>

</td>

</tr>

</table>

</body>

</html>
`;
}

module.exports = newsletterTemplate;