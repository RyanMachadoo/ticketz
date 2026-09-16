import React, { useState, useEffect } from "react";
import * as Yup from "yup";
import { Formik, Form, Field } from "formik";
import { toast } from "react-toastify";

import { makeStyles } from "@material-ui/core/styles";
import { green } from "@material-ui/core/colors";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Button,
  DialogActions,
  CircularProgress,
  TextField,
  Switch,
  FormControlLabel,
  FormGroup,
  Checkbox,
  Typography
} from "@material-ui/core";

import api from "../../services/api";
import { i18n } from "../../translate/i18n";
import toastError from "../../errors/toastError";

const useStyles = makeStyles(theme => ({
  root: {
    display: "flex",
    flexWrap: "wrap"
  },
  btnWrapper: {
    position: "relative"
  },
  buttonProgress: {
    color: green[500],
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -12,
    marginLeft: -12
  }
}));

// Eventos suportados pelo backend (DispatchWebhook.WEBHOOK_EVENTS).
export const WEBHOOK_EVENTS = [
  { value: "message.received", labelKey: "messageReceived" },
  { value: "message.sent", labelKey: "messageSent" },
  { value: "ticket.created", labelKey: "ticketCreated" },
  { value: "ticket.updated", labelKey: "ticketUpdated" }
];

const WebhookSchema = Yup.object().shape({
  name: Yup.string().min(2, "Too Short!").required("Required"),
  url: Yup.string().url("URL inválida").required("Required")
});

const WebhookModal = ({ open, onClose, webhookId }) => {
  const classes = useStyles();
  const initialState = {
    name: "",
    url: "",
    secret: "",
    active: true,
    events: []
  };
  const [webhook, setWebhook] = useState(initialState);

  useEffect(() => {
    const fetchWebhook = async () => {
      if (!webhookId) {
        setWebhook(initialState);
        return;
      }
      try {
        const { data } = await api.get(`/webhooks/${webhookId}`);
        setWebhook(prev => ({
          ...prev,
          ...data,
          secret: data.secret || "",
          events: Array.isArray(data.events) ? data.events : []
        }));
      } catch (err) {
        toastError(err);
      }
    };
    fetchWebhook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webhookId, open]);

  const handleClose = () => {
    onClose();
    setWebhook(initialState);
  };

  const handleSave = async values => {
    const data = { ...values, secret: values.secret || null };
    try {
      if (webhookId) {
        await api.put(`/webhooks/${webhookId}`, data);
      } else {
        await api.post("/webhooks", data);
      }
      toast.success(i18n.t("integrations.toasts.success"));
      handleClose();
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <div className={classes.root}>
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth scroll="paper">
        <DialogTitle>
          {webhookId
            ? i18n.t("integrations.modal.editTitle")
            : i18n.t("integrations.modal.addTitle")}
        </DialogTitle>
        <Formik
          initialValues={webhook}
          enableReinitialize={true}
          validationSchema={WebhookSchema}
          onSubmit={(values, actions) => {
            setTimeout(() => {
              handleSave(values);
              actions.setSubmitting(false);
            }, 400);
          }}
        >
          {({ values, touched, errors, isSubmitting, setFieldValue }) => (
            <Form>
              <DialogContent dividers>
                <div>
                  <Field
                    as={TextField}
                    label={i18n.t("integrations.modal.name")}
                    name="name"
                    autoFocus
                    error={touched.name && Boolean(errors.name)}
                    helperText={touched.name && errors.name}
                    variant="outlined"
                    margin="dense"
                    fullWidth
                  />
                </div>
                <div>
                  <Field
                    as={TextField}
                    label={i18n.t("integrations.modal.url")}
                    name="url"
                    placeholder="https://n8n.suaempresa.com/webhook/..."
                    error={touched.url && Boolean(errors.url)}
                    helperText={touched.url && errors.url}
                    variant="outlined"
                    margin="dense"
                    fullWidth
                  />
                </div>
                <div>
                  <Field
                    as={TextField}
                    label={i18n.t("integrations.modal.secret")}
                    name="secret"
                    helperText={i18n.t("integrations.modal.secretHelper")}
                    variant="outlined"
                    margin="dense"
                    fullWidth
                  />
                </div>

                <Typography
                  variant="subtitle2"
                  style={{ marginTop: 12, marginBottom: 4 }}
                >
                  {i18n.t("integrations.modal.events")}
                </Typography>
                <FormGroup>
                  {WEBHOOK_EVENTS.map(ev => (
                    <FormControlLabel
                      key={ev.value}
                      control={
                        <Checkbox
                          color="primary"
                          checked={values.events.includes(ev.value)}
                          onChange={e => {
                            const next = e.target.checked
                              ? [...values.events, ev.value]
                              : values.events.filter(x => x !== ev.value);
                            setFieldValue("events", next);
                          }}
                        />
                      }
                      label={i18n.t(`integrations.eventLabels.${ev.labelKey}`)}
                    />
                  ))}
                </FormGroup>

                <FormControlLabel
                  control={
                    <Field
                      as={Switch}
                      color="primary"
                      name="active"
                      checked={values.active}
                    />
                  }
                  label={i18n.t("integrations.modal.active")}
                />
              </DialogContent>
              <DialogActions>
                <Button
                  onClick={handleClose}
                  color="secondary"
                  disabled={isSubmitting}
                  variant="outlined"
                >
                  {i18n.t("integrations.modal.cancel")}
                </Button>
                <Button
                  type="submit"
                  color="primary"
                  disabled={isSubmitting}
                  variant="contained"
                  className={classes.btnWrapper}
                >
                  {webhookId
                    ? i18n.t("integrations.modal.saveEdit")
                    : i18n.t("integrations.modal.saveAdd")}
                  {isSubmitting && (
                    <CircularProgress size={24} className={classes.buttonProgress} />
                  )}
                </Button>
              </DialogActions>
            </Form>
          )}
        </Formik>
      </Dialog>
    </div>
  );
};

export default WebhookModal;
