import React from "react";

import { makeStyles } from "@material-ui/core/styles";
import { Dialog, DialogContent } from "@material-ui/core";
import ArrowBackIcon from "@material-ui/icons/ArrowBack";
import VideocamIcon from "@material-ui/icons/Videocam";
import CallIcon from "@material-ui/icons/Call";
import MoreVertIcon from "@material-ui/icons/MoreVert";
import DoneIcon from "@material-ui/icons/Done";
import DoneAllIcon from "@material-ui/icons/DoneAll";
import ErrorOutlineIcon from "@material-ui/icons/ErrorOutline";

import { useDate } from "../../hooks/useDate";

const WA_HEADER = "#075E54";
const WA_CHAT_BG = "#0b141a";
const WA_BUBBLE = "#202c33";

const useStyles = makeStyles(() => ({
  dialogContent: {
    padding: 0,
    background: "#000",
    overflow: "hidden"
  },
  phone: {
    width: 360,
    maxWidth: "100%",
    height: 680,
    maxHeight: "80vh",
    margin: "0 auto",
    background: WA_CHAT_BG,
    display: "flex",
    flexDirection: "column"
  },
  header: {
    background: WA_HEADER,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    padding: "10px 12px",
    gap: 10
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: "rgba(255,255,255,0.25)",
    flexShrink: 0
  },
  headerName: {
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 1.1
  },
  headerSub: {
    fontSize: 12,
    opacity: 0.85
  },
  headerIcons: {
    marginLeft: "auto",
    display: "flex",
    gap: 14,
    opacity: 0.95
  },
  chat: {
    flex: 1,
    overflowY: "auto",
    padding: 12,
    backgroundColor: WA_CHAT_BG,
    backgroundImage:
      "radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)",
    backgroundSize: "18px 18px"
  },
  dayChip: {
    display: "block",
    width: "fit-content",
    margin: "4px auto 12px auto",
    background: "#182229",
    color: "#8696a0",
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 8
  },
  bubble: {
    maxWidth: "85%",
    background: WA_BUBBLE,
    borderRadius: 8,
    borderTopLeftRadius: 0,
    overflow: "hidden",
    boxShadow: "0 1px 1px rgba(0,0,0,0.3)",
    marginBottom: 10
  },
  img: {
    width: "100%",
    display: "block"
  },
  body: {
    padding: "7px 9px 2px 9px",
    whiteSpace: "pre-wrap",
    fontFamily: "inherit",
    fontSize: 14,
    color: "#e9edef",
    margin: 0
  },
  footer: {
    padding: "0 9px",
    fontSize: 12,
    color: "#8696a0"
  },
  meta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
    padding: "2px 9px 6px 9px",
    fontSize: 11,
    color: "#8696a0"
  },
  btn: {
    borderTop: "1px solid #2a3942",
    padding: "9px",
    textAlign: "center",
    color: "#53bdeb",
    fontSize: 14,
    fontWeight: 500
  },
  ackIcon: {
    fontSize: 15
  }
}));

const CampaignPhonePreview = ({
  open,
  onClose,
  recipient,
  template
}) => {
  const classes = useStyles();
  const { datetimeToClient } = useDate();

  if (!recipient) return null;

  const imageUrl = template?.headerImageUrl;
  const footer = template?.footer;
  const buttons = template?.buttons || [];
  // Mensagem REAL enviada ao cliente (nunca o nome do template).
  let message = recipient.message || template?.body || "";
  if (/^\[Template:/i.test(message) && template?.body) message = template.body;

  // Horário curto (HH:mm) do envio.
  const sentFull = recipient.deliveredAt
    ? datetimeToClient(recipient.deliveredAt)
    : "";
  const shortTime = sentFull ? sentFull.split(" ").pop().slice(0, 5) : "";

  // Checkmark de status (como o cliente/empresa vê no WhatsApp).
  const renderAck = () => {
    if (recipient.ackFailedAt || recipient.ackStatus === "failed") {
      return <ErrorOutlineIcon className={classes.ackIcon} style={{ color: "#f15c6d" }} />;
    }
    if (recipient.ackReadAt || recipient.ackStatus === "read") {
      return <DoneAllIcon className={classes.ackIcon} style={{ color: "#53bdeb" }} />;
    }
    if (recipient.ackDeliveredAt || recipient.ackStatus === "delivered") {
      return <DoneAllIcon className={classes.ackIcon} />;
    }
    return <DoneIcon className={classes.ackIcon} />;
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs">
      <DialogContent className={classes.dialogContent}>
        <div className={classes.phone}>
          <div className={classes.header}>
            <ArrowBackIcon fontSize="small" />
            <div className={classes.avatar} />
            <div>
              <div className={classes.headerName}>
                {recipient.name || recipient.number}
              </div>
              <div className={classes.headerSub}>{recipient.number}</div>
            </div>
            <div className={classes.headerIcons}>
              <VideocamIcon fontSize="small" />
              <CallIcon fontSize="small" />
              <MoreVertIcon fontSize="small" />
            </div>
          </div>

          <div className={classes.chat}>
            <span className={classes.dayChip}>
              {sentFull ? sentFull.split(" ")[0] : "Hoje"}
            </span>

            <div className={classes.bubble}>
              {imageUrl && (
                <img src={imageUrl} alt="imagem enviada" className={classes.img} />
              )}
              <div className={classes.body}>{message || "—"}</div>
              {footer && <div className={classes.footer}>{footer}</div>}
              <div className={classes.meta}>
                <span>{shortTime}</span>
                {renderAck()}
              </div>
              {buttons.map((b, i) => (
                <div key={i} className={classes.btn}>
                  {b}
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CampaignPhonePreview;
